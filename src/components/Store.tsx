'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from 'firebase/auth';
import { onValue, ref, push, set, update, remove, runTransaction } from 'firebase/database';
import { auth, db, googleProvider, ADMIN_EMAIL } from '@/lib/firebase';
import { uploadImage } from '@/lib/supabase';
import type { Product, Category, Banner, Order } from '@/lib/types';
import { Search, ShoppingCart, User, LogOut, Plus, Minus, X, Globe, Printer, FileDown, CheckCircle, Trash2, Pencil, AlertTriangle, BellRing } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const DELIVERY = 40;
const money = (n: number) => `৳${Number(n || 0).toLocaleString('en-US')}`;
const fuzzy = (a: string, b: string) => {
  a = a.toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]/g, '');
  b = b.toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]/g, '');
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= Math.max(1, Math.floor(b.length * .28));
};

// গ্লোবাল অডিও এলিমেন্ট - যা লুপে রিং বাজাতে থাকবে
let loopAudio: HTMLAudioElement | null = null;

// ব্রাউজারে ইন-মেমোরি ৩ সেকেন্ডের জোরালো রিংটোন জেনারেট করা
function generateRingToneUri() {
  const sampleRate = 8000;
  const duration = 2.4; // ২.৪ সেকেন্ডের একটি রিং সাইকেল
  const totalSamples = Math.floor(sampleRate * duration);
  const buffer = new Uint8Array(44 + totalSamples);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) buffer[offset + i] = str.charCodeAt(i);
  };
  const writeUint32 = (offset: number, val: number) => {
    buffer[offset] = val & 0xff;
    buffer[offset + 1] = (val >> 8) & 0xff;
    buffer[offset + 2] = (val >> 16) & 0xff;
    buffer[offset + 3] = (val >> 24) & 0xff;
  };
  const writeUint16 = (offset: number, val: number) => {
    buffer[offset] = val & 0xff;
    buffer[offset + 1] = (val >> 8) & 0xff;
  };

  writeString(0, 'RIFF');
  writeUint32(4, 36 + totalSamples);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  writeUint32(16, 16);
  writeUint16(20, 1); // PCM
  writeUint16(22, 1); // Mono
  writeUint32(24, sampleRate);
  writeUint32(28, sampleRate);
  writeUint16(32, 1);
  writeUint16(34, 8); // 8-bit
  writeString(36, 'data');
  writeUint32(40, totalSamples);

  // জোরালো ও মিষ্টি রিংটোন ওয়েভ (বিপ-বিপ-রিং)
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = 128;

    // ০.০ - ০.২৫ সেকে: টোন ১ (৭৮০ Hz)
    if (t < 0.25) {
      sample += Math.sin(2 * Math.PI * 784 * t) * 70;
    }
    // ০.২৮ - ০.৫৫ সেকে: টোন ২ (১০৪৬ Hz)
    else if (t >= 0.28 && t < 0.55) {
      sample += Math.sin(2 * Math.PI * 1046 * t) * 75;
    }
    // ০.৬০ - ১.০০ সেকে: দীর্ঘ বেল টোন (১৩১৮ Hz)
    else if (t >= 0.60 && t < 1.05) {
      const fade = 1 - (t - 0.60) / 0.45;
      sample += Math.sin(2 * Math.PI * 1318 * t) * 70 * Math.max(0, fade);
    }
    // ১.০৫ থেকে ২.৪ সেকেন্ড পর্যন্ত পজ (রিংটোন বিরতি), তারপর স্বয়ংক্রিয় লুপে আবার বাজবে

    buffer[44 + i] = Math.max(0, Math.min(255, Math.floor(sample)));
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function startContinuousAlert() {
  try {
    if (!loopAudio) {
      loopAudio = new Audio(generateRingToneUri());
      loopAudio.loop = true; // একটানা বাজবে
    }
    loopAudio.currentTime = 0;
    loopAudio.play().catch((err) => {
      console.log('Audio autoplay blocked, click anywhere on page:', err);
    });
  } catch (err) {
    console.error('Audio initialization error:', err);
  }
}

function stopContinuousAlert() {
  if (loopAudio) {
    loopAudio.pause();
    loopAudio.currentTime = 0;
  }
}

export default function Store() {
  const [user, setUser] = useState<any>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [bannerIndex, setBannerIndex] = useState(0);
  const [lang, setLang] = useState<'bn' | 'en'>('bn');

  const [modal, setModal] = useState<'auth' | 'checkout' | 'orders' | 'admin' | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('Mymensingh Sadar');
  const [street, setStreet] = useState('');
  const [apartment, setApartment] = useState('');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [adminTab, setAdminTab] = useState('orders');

  // Edit states
  const [editProduct, setEditProduct] = useState<any>(null);
  const [editCategory, setEditCategory] = useState<any>(null);
  const [editBanner, setEditBanner] = useState<any>(null);

  // In-display Delete confirmation state
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    type: 'product' | 'category' | 'banner';
    id: string;
    title: string;
  } | null>(null);

  // New Order Alert Modal State
  const [newOrderPopup, setNewOrderPopup] = useState<Order | null>(null);
  const isFirstOrdersLoad = useRef(true);

  const [analysisFrom, setAnalysisFrom] = useState('');
  const [analysisTo, setAnalysisTo] = useState('');
  const [flyingProduct, setFlyingProduct] = useState<string | null>(null);
  const [cartJump, setCartJump] = useState(false);
  const [flightPoint, setFlightPoint] = useState<{ x: number; y: number } | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptPosition, setReceiptPosition] = useState<'left' | 'middle' | 'right'>('middle');

  const [productForm, setProductForm] = useState<any>({ name: '', nameBn: '', price: '', stock: '', description: '', categoryId: '', priority: 0 });
  const [categoryForm, setCategoryForm] = useState<any>({ name: '', nameBn: '', priority: 0 });
  const [bannerForm, setBannerForm] = useState<any>({ title: '', priority: 0 });

  const isAdmin = (user?.email || '').trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
  const t = (bn: string, en: string) => (lang === 'bn' ? bn : en);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setCustomerName(u.displayName || '');
        setEmail(u.email || '');
        const signedInEmail = (u.email || '').trim().toLowerCase();
        if (signedInEmail === ADMIN_EMAIL.trim().toLowerCase()) {
          setAdminTab('orders');
          setModal('admin');
        } else {
          setModal((current) => (current === 'admin' ? null : current));
        }
      } else {
        setModal(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubs = [
      ['products', setProducts],
      ['categories', setCategories],
      ['banners', setBanners],
    ].map(([key, fn]: any) =>
      onValue(
        ref(db, key),
        (s: any) => {
          const v = s.val() || {};
          fn(
            Object.entries(v)
              .map(([id, x]: any) => ({ id, ...x }))
              .filter((item: any) => item.active !== false)
              .sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0))
          );
        },
        (err: any) => setError(`Firebase error: ${err.message}`)
      )
    );
    return () => unsubs.forEach((x) => x());
  }, []);

  useEffect(() => {
    if (!user) return;
    const path = isAdmin ? 'orders' : `userOrders/${user.uid}`;
    isFirstOrdersLoad.current = true;

    return onValue(ref(db, path), (s) => {
      const v = s.val() || {};
      const orderList: Order[] = Object.entries(v)
        .map(([id, x]: any) => ({ id, ...x }))
        .sort((a: any, b: any) => b.createdAt - a.createdAt);

      setOrders(orderList);

      // প্রথমবার পেজ লোড হলে অ্যালার্ম বাজবে না
      if (isFirstOrdersLoad.current) {
        isFirstOrdersLoad.current = false;
        return;
      }

      // নতুন কোনো Pending অর্ডার ঢুকলে একনাগাড়ে রিং বাজবে যতক্ষণ না Accept করা হয়
      if (isAdmin && orderList.length > 0) {
        const latest = orderList[0];
        if (latest.status === 'Pending') {
          startContinuousAlert();
          setNewOrderPopup(latest);
        }
      }
    });
  }, [user, isAdmin]);

  useEffect(() => {
    try {
      setCart(JSON.parse(localStorage.getItem('shohoz-cart') || '{}'));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem('shohoz-cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = setInterval(() => setBannerIndex((i) => (i + 1) % banners.length), 4500);
    return () => clearInterval(timer);
  }, [banners]);

  const visible = useMemo(
    () =>
      products
        .filter(
          (p) =>
            p.active !== false &&
            (category === 'all' || p.categoryId === category) &&
            (!search || fuzzy(p.name, search) || fuzzy(p.nameBn || '', search) || fuzzy(p.description || '', search))
        )
        .sort((a, b) => (b.priority || 0) - (a.priority || 0)),
    [products, category, search]
  );

  const cartRows = products.filter((p) => cart[p.id] > 0).map((p) => ({ ...p, qty: cart[p.id] }));
  const subtotal = cartRows.reduce((s, p) => s + p.price * p.qty, 0);
  const total = subtotal + (cartRows.length ? DELIVERY : 0);
  const cartCount = cartRows.reduce((s, p) => s + p.qty, 0);

  const add = (p: Product) => {
    if ((cart[p.id] || 0) >= p.stock) {
      setNotice(t('স্টক পর্যাপ্ত নেই', 'Not enough stock'));
      return;
    }
    const button = document.querySelector(`[data-product-id="${p.id}"] .addBtn`) as HTMLElement | null;
    const rect = button?.getBoundingClientRect();
    if (rect) setFlightPoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    setFlyingProduct(p.id);
    setCart((c) => ({ ...c, [p.id]: (c[p.id] || 0) + 1 }));
    setCartJump(true);
    window.setTimeout(() => {
      setFlyingProduct(null);
      setFlightPoint(null);
    }, 850);
    window.setTimeout(() => setCartJump(false), 520);
  };

  const changeQty = (id: string, n: number) =>
    setCart((c) => {
      const q = (c[id] || 0) + n;
      const p = products.find((x) => x.id === id);
      if (q <= 0) {
        const z = { ...c };
        delete z[id];
        return z;
      }
      if (p && q > p.stock) {
        setNotice(t('স্টক পর্যাপ্ত নেই', 'Not enough stock'));
        return c;
      }
      return { ...c, [id]: q };
    });

  async function authSubmit(e: any) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (authMode === 'signup') {
        const cr = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cr.user, { displayName: authName });
        await set(ref(db, `users/${cr.user.uid}`), { name: authName, email, phone: authPhone, createdAt: Date.now() });
        setCustomerName(authName);
        setPhone(authPhone);
      } else await signInWithEmailAndPassword(auth, email, password);
      setModal(null);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin() {
    setError('');
    setBusy(true);
    try {
      const cr = await signInWithPopup(auth, googleProvider);
      setModal(null);
      try {
        await update(ref(db, `users/${cr.user.uid}`), { name: cr.user.displayName || '', email: cr.user.email || '' });
      } catch (e) {}
    } catch (e: any) {
      setError(e.message || 'Google sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder(e: any) {
    e.preventDefault();
    if (!cartRows.length) return;
    setBusy(true);
    setError('');
    try {
      const orderRef = push(ref(db, 'orders'));
      const order = {
        uid: user?.uid || 'guest',
        customerName,
        phone,
        city,
        street,
        apartment,
        note,
        items: cartRows.map((p) => ({ id: p.id, name: p.name, price: p.price, qty: p.qty, image: p.image || '' })),
        subtotal,
        delivery: DELIVERY,
        total,
        status: 'Pending',
        createdAt: Date.now(),
      };
      await set(orderRef, order);
      if (user) {
        await set(ref(db, `userOrders/${user.uid}/${orderRef.key}`), { ...order, id: orderRef.key });
        await update(ref(db, `users/${user.uid}`), { name: customerName, phone, email: user.email || '' });
      }
      setCart({});
      setModal(null);
      setNotice(t('ধন্যবাদ! আপনার অর্ডার গ্রহণ করা হয়েছে।', 'Thank you! Your order has been placed.'));
    } catch (e: any) {
      setError(e.message || 'Order failed');
    } finally {
      setBusy(false);
    }
  }

  /* Admin Product Save / Update */
  async function saveProduct(e: any) {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    try {
      let image = editProduct?.image || '';
      const file = (document.getElementById('product-image') as HTMLInputElement)?.files?.[0];
      if (file) image = await uploadImage(file, 'products');
      const id = editProduct?.id || push(ref(db, 'products')).key!;
      await set(ref(db, `products/${id}`), {
        ...productForm,
        price: Number(productForm.price),
        stock: Number(productForm.stock),
        priority: Number(productForm.priority) || 0,
        image,
        active: true,
      });
      setEditProduct(null);
      setProductForm({ name: '', nameBn: '', price: '', stock: '', description: '', categoryId: '', priority: 0 });
      setNotice(t('পণ্য সফলভাবে সংরক্ষিত হয়েছে! ✨', 'Product successfully saved! ✨'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /* Admin Category Save / Update */
  async function saveCategory(e: any) {
    e.preventDefault();
    try {
      const id = editCategory?.id || push(ref(db, 'categories')).key!;
      await set(ref(db, `categories/${id}`), {
        ...categoryForm,
        priority: Number(categoryForm.priority) || 0,
        active: true,
      });
      setEditCategory(null);
      setCategoryForm({ name: '', nameBn: '', priority: 0 });
      setNotice(t('ক্যাটাগরি সংরক্ষিত হয়েছে! ✨', 'Category successfully saved! ✨'));
    } catch (e: any) {
      setError(e.message);
    }
  }

  /* Admin Banner Save / Update */
  async function saveBanner(e: any) {
    e.preventDefault();
    setBusy(true);
    try {
      let image = editBanner?.image || '';
      const file = (document.getElementById('banner-image') as HTMLInputElement)?.files?.[0];
      if (file) {
        image = await uploadImage(file, 'banners');
      } else if (!image) {
        throw new Error('Select banner image');
      }
      const id = editBanner?.id || push(ref(db, 'banners')).key!;
      await set(ref(db, `banners/${id}`), {
        ...bannerForm,
        image,
        priority: Number(bannerForm.priority) || 0,
        active: true,
      });
      setEditBanner(null);
      setBannerForm({ title: '', priority: 0 });
      const fileInput = document.getElementById('banner-image') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      setNotice(t('ব্যানার সফলভাবে সংরক্ষিত হয়েছে! ✨', 'Banner successfully saved! ✨'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /* Permanent Delete via In-display Confirmation Dialog */
  async function handleConfirmDelete() {
    if (!deleteDialog) return;
    setBusy(true);
    try {
      const { type, id } = deleteDialog;
      await remove(ref(db, `${type === 'product' ? 'products' : type === 'category' ? 'categories' : 'banners'}/${id}`));
      setNotice(t('সফলভাবে মুছে ফেলা হয়েছে! 🗑️', 'Deleted successfully! 🗑️'));
      setDeleteDialog(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(o: Order, status: Order['status']) {
    if (!isAdmin) return;
    try {
      if (o.status === status) return;

      // যেকোনো অর্ডার Accept / Cancel / Update করলে অ্যালার্ম সম্পূর্ণ বন্ধ হবে
      stopContinuousAlert();
      if (newOrderPopup?.id === o.id) {
        setNewOrderPopup(null);
      }

      if (status === 'Delivered' && o.status !== 'Delivered') {
        for (const item of o.items) {
          await runTransaction(ref(db, `products/${item.id}/stock`), (v) => Math.max(0, Number(v || 0) - item.qty));
        }
      }
      if (status === 'Cancelled' && o.status === 'Delivered') {
        for (const item of o.items) {
          await runTransaction(ref(db, `products/${item.id}/stock`), (v) => Number(v || 0) + item.qty);
        }
      }
      await update(ref(db, `orders/${o.id}`), { status, updatedAt: Date.now() });
      if (o.uid && o.uid !== 'guest') await update(ref(db, `userOrders/${o.uid}/${o.id}`), { status, updatedAt: Date.now() });
    } catch (e: any) {
      setError(e.message);
    }
  }

  function printReceipt(o: Order) {
    setReceiptOrder(o);
    setReceiptPosition('middle');
  }

  function confirmPrintReceipt() {
    if (!receiptOrder) return;
    const o = receiptOrder;
    const column = receiptPosition === 'left' ? 0 : receiptPosition === 'middle' ? 1 : 2;
    const w = window.open('', '_blank', 'width=900,height=900');
    if (!w) {
      setNotice(t('প্রিন্ট উইন্ডো অনুমতি দিন, তারপর আবার চেষ্টা করুন', 'Allow the print window, then try again'));
      return;
    }
    const safe = (value: any) =>
      String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
    w.document.write(`<html><head><title>Shohoz Mart Receipt</title><style>
      @page{size:A4 portrait;margin:0}*{box-sizing:border-box}
      html,body{margin:0;padding:0;font-family:Arial,sans-serif;color:#111}
      body{width:210mm;height:297mm}
      .sheet{width:210mm;height:297mm;padding:2mm;display:grid;grid-template-columns:repeat(3,1fr);gap:1mm}
      .slot{height:293mm;min-width:0;display:flex;align-items:flex-start;justify-content:center;overflow:hidden}
      .receipt{width:100%;height:293mm;padding:3mm 2.5mm;border:1px dashed #999;font-size:7.5pt;display:flex;flex-direction:column;overflow:hidden}
      .receipt h2{text-align:center;margin:0 0 2mm;font-size:13pt;line-height:1.2}
      .receipt p{margin:1mm 0;font-size:7pt;line-height:1.25;overflow-wrap:anywhere}
      .line{border-top:1px dashed #555;margin:2mm 0}h3{text-align:center;margin:1mm 0;font-size:9pt}
      table{width:100%;font-size:7pt;border-collapse:collapse;table-layout:fixed}
      td,th{padding:1.1mm .4mm;text-align:left;border-bottom:1px dotted #bbb;overflow-wrap:anywhere;vertical-align:top}
      .r{text-align:right}.total{font-weight:bold;font-size:9pt;border-top:1px solid #000;padding-top:2mm}
      .thanks{text-align:center;margin-top:auto;padding-top:3mm;font-weight:bold}
      .blank{visibility:hidden}
      @media screen{body{background:#e9ece9}.sheet{margin:10px auto;background:#fff;box-shadow:0 2px 15px #0002}}
    </style></head><body><div class="sheet">
      ${[0, 1, 2]
        .map(
          (i) => `<div class="slot">${
            i === column
              ? `<section class="receipt">
          <h2>🛍 Shohoz Mart</h2><p style="text-align:center">Mymensingh Sadar · Helpline: 01822211566</p>
          <div class="line"></div><h3>Money Receipt / মানি রিসিট</h3>
          <p>Date: ${safe(new Date(o.createdAt).toLocaleString())}</p><p>Order: ${safe(o.id)}</p>
          <p>Customer: ${safe(o.customerName)} | ${safe(o.phone)}</p><p>Address: ${safe(o.city)}, ${safe(o.street)} ${safe(o.apartment || '')}</p>
          <div class="line"></div><table><tr><th style="width:52%">Product</th><th style="width:13%">Qty</th><th class="r">Total</th></tr>
          ${o.items.map((it) => `<tr><td>${safe(it.name)}</td><td>${safe(it.qty)}</td><td class="r">${safe(money(it.price * it.qty))}</td></tr>`).join('')}</table>
          <div class="line"></div><p class="r">Subtotal: ${safe(money(o.subtotal))}</p><p class="r">Delivery: ${safe(money(o.delivery))}</p>
          <p class="r total">Total: ${safe(money(o.total))}</p><p class="thanks">Thank you for shopping with Shohoz Mart!</p>
        </section>`
              : '<div class="receipt blank"></div>'
          }</div>`
        )
        .join('')}
    </div><script>window.onload=()=>{window.focus();window.print()}</script></body></html>`);
    w.document.close();
    setReceiptOrder(null);
  }

  const delivered = orders.filter(
    (o) =>
      o.status === 'Delivered' &&
      (!analysisFrom || o.createdAt >= new Date(analysisFrom + 'T00:00:00').getTime()) &&
      (!analysisTo || o.createdAt <= new Date(analysisTo + 'T23:59:59').getTime())
  );

  function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Shohoz Mart - Delivered Orders Statement', 14, 18);
    doc.setFontSize(10);
    doc.text(`From: ${analysisFrom || 'All'}   To: ${analysisTo || 'All'}   Orders: ${delivered.length}`, 14, 26);
    autoTable(doc, {
      startY: 32,
      head: [['Date', 'Order ID', 'Customer', 'Phone', 'Items', 'Total']],
      body: delivered.map((o) => [
        new Date(o.createdAt).toLocaleDateString(),
        o.id.slice(-7),
        o.customerName,
        o.phone,
        o.items.map((i) => `${i.name} x${i.qty}`).join(', '),
        money(o.total),
      ]),
      foot: [['', '', '', '', 'Grand total', money(delivered.reduce((s, o) => s + o.total, 0))]],
    });
    doc.save('shohoz-mart-statement.pdf');
  }

  const statusColor = (s: string) => (s === 'Delivered' ? 'green' : s === 'Cancelled' ? 'red' : s === 'Accepted' ? 'blue' : 'orange');

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brandIcon">S</span>
          <span>
            Shohoz <b>Mart</b>
          </span>
        </a>
        <div className="headActions">
          <button className="lang" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}>
            <Globe size={17} />
            {lang === 'bn' ? 'EN' : 'বাংলা'}
          </button>
          {user ? (
            <>
              <button className="account" onClick={() => setModal(isAdmin ? 'admin' : 'orders')}>
                <User size={17} />
                <span>{isAdmin ? 'Admin Panel' : user.displayName || user.email?.split('@')[0]}</span>
              </button>
              <button className="iconBtn" title="Logout" onClick={() => signOut(auth)}>
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button
              className="loginBtn"
              onClick={() => {
                setAuthMode('login');
                setModal('auth');
              }}
            >
              {t('লগইন', 'Login')}
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">{t('আপনার প্রতিদিনের বাজার', 'YOUR DAILY GROCERY')}</span>
          <h1>{t('বাজার এখন হাতের মুঠোয়', 'Groceries, made easy.')}</h1>
          <p>{t('সেরা পণ্য, সঠিক দাম — ঘরে বসেই অর্ডার করুন।', 'Fresh essentials at fair prices, delivered to your door.')}</p>
        </div>
        <div className="heroArt">
          <span>🥬</span>
          <span>🥑</span>
          <span>🥕</span>
          <span>🛒</span>
        </div>
      </section>

      <section className="searchWrap">
        <Search size={20} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('পণ্যের নাম লিখে খুঁজুন...', 'Search products...')} />
        {search && (
          <button onClick={() => setSearch('')}>
            <X size={17} />
          </button>
        )}
      </section>

      {/* Banner Section */}
      {banners.length > 0 && (
        <section
          className="banner"
          style={{
            backgroundImage: `linear-gradient(90deg,rgba(0,67,39,.8),rgba(0,67,39,.15)),url("${banners[bannerIndex % banners.length]?.image}")`,
          }}
        >
          <div>
            <span>SHOHOZ MART</span>
            <h2>{banners[bannerIndex % banners.length]?.title || t('প্রতিদিনের বাজার, সহজে', 'Everyday shopping, simplified')}</h2>
          </div>
          <div className="dots">
            {banners.map((b, i) => (
              <button key={b.id} className={i === bannerIndex ? 'selected' : ''} onClick={() => setBannerIndex(i)} />
            ))}
          </div>
        </section>
      )}

      {/* Categories */}
      <section className="section">
        <div className="sectionHead">
          <div>
            <span className="eyebrow">{t('বেছে নিন', 'EXPLORE')}</span>
            <h2>{t('ক্যাটাগরি', 'Categories')}</h2>
          </div>
        </div>
        <div className="categories">
          <button className={`category ${category === 'all' ? 'chosen' : ''}`} onClick={() => setCategory('all')}>
            <span>🛍️</span>
            {t('সব পণ্য', 'All items')}
          </button>
          {categories.map((c) => (
            <button className={`category ${category === c.id ? 'chosen' : ''}`} key={c.id} onClick={() => setCategory(c.id)}>
              <span>{c.image ? <img src={c.image} /> : '🥗'}</span>
              {lang === 'bn' ? c.nameBn || c.name : c.name}
            </button>
          ))}
        </div>
      </section>

      {/* Product List Showcase */}
      <section className="section productsSection">
        <div className="sectionHead">
          <div>
            <span className="eyebrow">{t('আপনার পছন্দের', 'HANDPICKED FOR YOU')}</span>
            <h2>{t('জনপ্রিয় পণ্য', 'Popular products')}</h2>
          </div>
          <span className="muted">
            {visible.length} {t('টি পণ্য', 'products')}
          </span>
        </div>
        <div className="productGrid">
          {visible.map((p) => {
            const displayName = lang === 'bn' ? p.nameBn || p.name : p.name;
            const displayDesc = p.description || t('ভালো মানের ফ্রেশ পণ্য', 'Quality grocery item');
            return (
              <article className="product" key={p.id} data-product-id={p.id}>
                <div className="productPic">
                  {p.image ? <img src={p.image} alt={displayName} /> : <div className="placeholder">🥦</div>}
                  <span className={`stock ${p.stock > 0 ? 'in' : 'out'}`}>
                    {p.stock > 0 ? `${t('স্টক', 'Stock')}: ${p.stock}` : t('স্টক শেষ', 'Out of stock')}
                  </span>
                </div>
                <div className="productInfo">
                  <small className="catBadge">{categories.find((c) => c.id === p.categoryId)?.name || 'Grocery'}</small>
                  <h3 title={displayName}>{displayName}</h3>
                  <p title={displayDesc}>{displayDesc}</p>
                  <div className="productBottom">
                    <strong>{money(p.price)}</strong>
                    <button className="addBtn" disabled={p.stock <= 0} onClick={() => add(p)}>
                      <Plus size={19} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {visible.length === 0 && <div className="empty">কোনো পণ্য পাওয়া যায়নি।</div>}
      </section>

      <footer>
        <b>Shohoz Mart</b>
        <span>Mymensingh Sadar · Helpline: 01822211566</span>
        <small>© {new Date().getFullYear()} Shohoz Mart. All rights reserved.</small>
      </footer>

      {/* Floating Elements */}
      {flyingProduct && flightPoint && (
        <span
          key={flyingProduct + String(cartCount)}
          className="flyingDot"
          style={
            {
              left: flightPoint.x,
              top: flightPoint.y,
              '--fly-x': `calc(50vw - ${flightPoint.x}px)`,
              '--fly-y': `calc(100vh - ${flightPoint.y}px - 42px)`,
            } as React.CSSProperties
          }
          aria-hidden="true"
        >
          ●
        </span>
      )}
      <button className={`cartFloat ${cartJump ? 'cartJump' : ''}`} onClick={() => setModal('checkout')}>
        <ShoppingCart size={22} />
        <span>{t('কার্ট', 'Cart')}</span>
        <b>{cartCount}</b>
      </button>
      <a className="whatsappFloat" href="https://wa.me/8801822211566" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp support">
        <span className="waIcon">◉</span>
        <span>WhatsApp Support</span>
      </a>

      {/* Auth Modal */}
      {modal === 'auth' && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="dialog authDialog">
            <button className="close" onClick={() => setModal(null)}>
              <X />
            </button>
            <div className="modalLogo">S</div>
            <h2>{authMode === 'login' ? t('স্বাগতম', 'Welcome back') : t('অ্যাকাউন্ট তৈরি করুন', 'Create your account')}</h2>
            <p className="muted">{t('Shohoz Mart-এ কেনাকাটা শুরু করুন', 'Sign in to shop with Shohoz Mart')}</p>
            <div className="tabs">
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>
                {t('লগইন', 'Login')}
              </button>
              <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>
                {t('অ্যাকাউন্ট খুলুন', 'Create account')}
              </button>
            </div>
            <form onSubmit={authSubmit}>
              {authMode === 'signup' && (
                <>
                  <input required placeholder={t('আপনার নাম', 'Your name')} value={authName} onChange={(e) => setAuthName(e.target.value)} />
                  <input required placeholder={t('মোবাইল নম্বর', 'Phone number')} value={authPhone} onChange={(e) => setAuthPhone(e.target.value)} />
                </>
              )}
              <input required type="email" placeholder="Gmail / Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input
                required
                minLength={6}
                type="password"
                placeholder={t('পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)', 'Password (6+ characters)')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <p className="error">{error}</p>}
              <button className="primary full" disabled={busy}>
                {busy ? 'Please wait...' : authMode === 'login' ? t('লগইন করুন', 'Login') : t('অ্যাকাউন্ট তৈরি করুন', 'Create account')}
              </button>
            </form>
            <div className="or">OR</div>
            <button className="googleBtn" onClick={googleLogin}>
              G&nbsp; {t('Google দিয়ে চালিয়ে যান', 'Continue with Google')}
            </button>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {modal === 'checkout' && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="dialog checkoutDialog">
            <button className="close" onClick={() => setModal(null)}>
              <X />
            </button>
            <h2>{t('আপনার কার্ট', 'Your cart')}</h2>
            {cartRows.length === 0 ? (
              <div className="empty">
                🛒<p>{t('আপনার কার্ট খালি', 'Your cart is empty')}</p>
              </div>
            ) : (
              <>
                <div className="checkoutItems">
                  {cartRows.map((p) => (
                    <div className="checkoutItem" key={p.id}>
                      <div className="miniPic">{p.image ? <img src={p.image} /> : '🥬'}</div>
                      <div className="grow">
                        <b>{p.name}</b>
                        <small>
                          {money(p.price)} × {p.qty}
                        </small>
                      </div>
                      <div className="qty">
                        <button onClick={() => changeQty(p.id, -1)}>
                          <Minus size={14} />
                        </button>
                        {p.qty}
                        <button onClick={() => changeQty(p.id, 1)}>
                          <Plus size={14} />
                        </button>
                      </div>
                      <b>{money(p.price * p.qty)}</b>
                    </div>
                  ))}
                </div>
                <form onSubmit={placeOrder} className="checkoutForm">
                  <h3>{t('ডেলিভারি তথ্য', 'Delivery information')}</h3>
                  {!user && (
                    <div className="hint">
                      {t('লগইন ছাড়াই অর্ডার করতে পারবেন। অর্ডার ট্র্যাক করতে অ্যাকাউন্টে লগইন করুন।', 'You can order as a guest. Sign in to view order history.')}{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setModal('auth');
                          setAuthMode('login');
                        }}
                      >
                        Login
                      </button>
                    </div>
                  )}
                  <div className="two">
                    <input required placeholder={t('আপনার নাম', 'Full name')} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                    <input required placeholder={t('মোবাইল নম্বর', 'Phone number')} value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <input required placeholder={t('শহর / এলাকা', 'City / Area')} value={city} onChange={(e) => setCity(e.target.value)} />
                  <input required placeholder={t('রাস্তা / বাসার ঠিকানা', 'Street / House address')} value={street} onChange={(e) => setStreet(e.target.value)} />
                  <input
                    placeholder={t('অ্যাপার্টমেন্ট / ফ্ল্যাট (ঐচ্ছিক)', 'Apartment / Flat (optional)')}
                    value={apartment}
                    onChange={(e) => setApartment(e.target.value)}
                  />
                  <textarea
                    placeholder={t('অতিরিক্ত নির্দেশনা (ঐচ্ছিক)', 'Additional note (optional)')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="bill">
                    <div>
                      <span>{t('সাবটোটাল', 'Subtotal')}</span>
                      <b>{money(subtotal)}</b>
                    </div>
                    <div>
                      <span>{t('ডেলিভারি চার্জ', 'Delivery charge')}</span>
                      <b>{money(DELIVERY)}</b>
                    </div>
                    <div className="grand">
                      <span>{t('সর্বমোট', 'Grand total')}</span>
                      <b>{money(total)}</b>
                    </div>
                  </div>
                  {error && <p className="error">{error}</p>}
                  <button disabled={busy} className="primary full">
                    {busy ? t('অর্ডার হচ্ছে...', 'Placing order...') : t('অর্ডার কনফার্ম করুন', 'Place order')}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Customer Orders Modal */}
      {modal === 'orders' && (
        <div className="overlay">
          <div className="dialog wide">
            <button className="close" onClick={() => setModal(null)}>
              <X />
            </button>
            <h2>{t('আমার অর্ডার', 'My orders')}</h2>
            {orders.map((o) => (
              <OrderCard key={o.id} o={o} onPrint={printReceipt} />
            ))}
          </div>
        </div>
      )}

      {/* Admin Panel Modal */}
      {modal === 'admin' && isAdmin && (
        <div className="overlay">
          <div className="dialog adminDialog">
            <button className="close" onClick={() => setModal(null)}>
              <X />
            </button>
            <div className="adminTitle">
              <div>
                <span className="eyebrow">SHOHOZ MART</span>
                <h2>Admin Dashboard</h2>
              </div>
              <span className="adminPill">ADMIN</span>
            </div>
            <div className="adminTabs">
              {[
                ['orders', 'Orders'],
                ['products', 'Products'],
                ['categories', 'Categories'],
                ['banners', 'Banners'],
                ['analysis', 'Analysis'],
              ].map(([k, v]) => (
                <button
                  key={k}
                  className={adminTab === k ? 'active' : ''}
                  onClick={() => {
                    setAdminTab(k);
                    setError('');
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
            {error && <p className="error">{error}</p>}

            {/* Orders Tab */}
            {adminTab === 'orders' && (
              <div className="adminList">
                {orders.map((o) => (
                  <div className="orderCard" key={o.id}>
                    <div className="orderTop">
                      <b>
                        #{o.id.slice(-7)} · {o.customerName}
                      </b>
                      <span className={`status ${statusColor(o.status)}`}>{o.status}</span>
                    </div>
                    <p>
                      {o.phone} · {o.city}, {o.street} {o.apartment}
                    </p>
                    <small>{new Date(o.createdAt).toLocaleString()}</small>
                    <div className="orderProducts">
                      {o.items.map((i) => (
                        <span key={i.id}>
                          {i.name} × {i.qty}
                        </span>
                      ))}
                    </div>
                    <div className="orderBottom">
                      <b>{money(o.total)}</b>
                      <div>
                        <button className="outline" onClick={() => printReceipt(o)}>
                          <Printer size={15} /> Receipt
                        </button>
                        {o.status !== 'Accepted' && o.status !== 'Delivered' && (
                          <button className="outline blue" onClick={() => setStatus(o, 'Accepted')}>
                            Accept
                          </button>
                        )}
                        {o.status !== 'Delivered' && (
                          <button className="outline green" onClick={() => setStatus(o, 'Delivered')}>
                            Delivered
                          </button>
                        )}
                        {o.status !== 'Cancelled' && (
                          <button className="outline red" onClick={() => setStatus(o, 'Cancelled')}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Products Tab */}
            {adminTab === 'products' && (
              <>
                <form className="adminForm" onSubmit={saveProduct}>
                  <h3>{editProduct ? 'Edit product' : 'Add product'}</h3>
                  <div className="two">
                    <input
                      required
                      placeholder="Product name (English)"
                      value={productForm.name}
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    />
                    <input
                      placeholder="পণ্যের নাম (বাংলা)"
                      value={productForm.nameBn}
                      onChange={(e) => setProductForm({ ...productForm, nameBn: e.target.value })}
                    />
                  </div>
                  <div className="two">
                    <input
                      required
                      type="number"
                      min="0"
                      placeholder="Price (৳)"
                      value={productForm.price}
                      onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    />
                    <input
                      required
                      type="number"
                      min="0"
                      placeholder="Stock"
                      value={productForm.stock}
                      onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                    />
                  </div>
                  <select value={productForm.categoryId} onChange={(e) => setProductForm({ ...productForm, categoryId: e.target.value })}>
                    <option value="">Choose category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Priority (Higher shows first)"
                    type="number"
                    value={productForm.priority}
                    onChange={(e) => setProductForm({ ...productForm, priority: e.target.value })}
                  />
                  <textarea
                    placeholder="Description"
                    value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  />
                  <input id="product-image" type="file" accept="image/*" />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="primary" disabled={busy}>
                      {editProduct ? 'Update product' : 'Save product'}
                    </button>
                    {editProduct && (
                      <button
                        type="button"
                        className="outline"
                        onClick={() => {
                          setEditProduct(null);
                          setProductForm({ name: '', nameBn: '', price: '', stock: '', description: '', categoryId: '', priority: 0 });
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>

                <div className="adminList">
                  {products.map((p) => (
                    <div className="manageRow" key={p.id}>
                      <div className="miniPic">{p.image ? <img src={p.image} /> : '🥦'}</div>
                      <div className="grow">
                        <b>{p.name}</b>
                        <small>
                          {money(p.price)} · Stock {p.stock}
                        </small>
                      </div>
                      <button
                        className="outline"
                        title="Edit"
                        onClick={() => {
                          setEditProduct(p);
                          setProductForm({ ...p });
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="outline red"
                        title="Delete"
                        onClick={() =>
                          setDeleteDialog({
                            open: true,
                            type: 'product',
                            id: p.id,
                            title: p.name || 'this product',
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Categories Tab */}
            {adminTab === 'categories' && (
              <>
                <form className="adminForm" onSubmit={saveCategory}>
                  <h3>{editCategory ? 'Edit category' : 'Add category'}</h3>
                  <div className="two">
                    <input
                      required
                      placeholder="Name (English)"
                      value={categoryForm.name}
                      onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                    />
                    <input
                      placeholder="নাম (বাংলা)"
                      value={categoryForm.nameBn}
                      onChange={(e) => setCategoryForm({ ...categoryForm, nameBn: e.target.value })}
                    />
                  </div>
                  <input
                    type="number"
                    placeholder="Priority"
                    value={categoryForm.priority}
                    onChange={(e) => setCategoryForm({ ...categoryForm, priority: e.target.value })}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="primary">{editCategory ? 'Update category' : 'Add category'}</button>
                    {editCategory && (
                      <button
                        type="button"
                        className="outline"
                        onClick={() => {
                          setEditCategory(null);
                          setCategoryForm({ name: '', nameBn: '', priority: 0 });
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
                {categories.map((c) => (
                  <div className="manageRow" key={c.id}>
                    <b>
                      {c.name} / {c.nameBn}
                    </b>
                    <span className="grow" />
                    <button
                      className="outline"
                      title="Edit"
                      onClick={() => {
                        setEditCategory(c);
                        setCategoryForm({ name: c.name, nameBn: c.nameBn || '', priority: c.priority || 0 });
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="outline red"
                      title="Delete"
                      onClick={() =>
                        setDeleteDialog({
                          open: true,
                          type: 'category',
                          id: c.id,
                          title: c.name || 'this category',
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </>
            )}

            {/* Banners Tab */}
            {adminTab === 'banners' && (
              <>
                <form className="adminForm" onSubmit={saveBanner}>
                  <h3>{editBanner ? 'Edit banner' : 'Add banner'}</h3>
                  <input
                    placeholder="Banner title"
                    value={bannerForm.title}
                    onChange={(e) => setBannerForm({ ...bannerForm, title: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="Priority (higher shows first)"
                    value={bannerForm.priority}
                    onChange={(e) => setBannerForm({ ...bannerForm, priority: e.target.value })}
                  />
                  <input id="banner-image" type="file" accept="image/*" />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="primary" disabled={busy}>
                      {editBanner ? 'Update banner' : 'Upload banner'}
                    </button>
                    {editBanner && (
                      <button
                        type="button"
                        className="outline"
                        onClick={() => {
                          setEditBanner(null);
                          setBannerForm({ title: '', priority: 0 });
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
                {banners.map((b) => (
                  <div className="manageRow" key={b.id}>
                    <img className="bannerThumb" src={b.image} alt={b.title} />
                    <b className="grow">{b.title || 'Untitled Banner'}</b>
                    <button
                      className="outline"
                      title="Edit"
                      onClick={() => {
                        setEditBanner(b);
                        setBannerForm({ title: b.title || '', priority: b.priority || 0 });
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="outline red"
                      title="Delete"
                      onClick={() =>
                        setDeleteDialog({
                          open: true,
                          type: 'banner',
                          id: b.id,
                          title: b.title || 'this banner',
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </>
            )}

            {/* Analysis Tab */}
            {adminTab === 'analysis' && (
              <>
                <div className="filterDates">
                  <label>
                    From <input type="date" value={analysisFrom} onChange={(e) => setAnalysisFrom(e.target.value)} />
                  </label>
                  <label>
                    To <input type="date" value={analysisTo} onChange={(e) => setAnalysisTo(e.target.value)} />
                  </label>
                  <button className="primary" onClick={exportPDF}>
                    <FileDown size={16} /> Download PDF
                  </button>
                </div>
                <div className="stats">
                  <div>
                    <small>Delivered orders</small>
                    <b>{delivered.length}</b>
                  </div>
                  <div>
                    <small>Sales total</small>
                    <b>{money(delivered.reduce((s, o) => s + o.total, 0))}</b>
                  </div>
                </div>
                {delivered.map((o) => (
                  <div className="orderCard" key={o.id}>
                    <div className="orderTop">
                      <b>
                        #{o.id.slice(-7)} · {o.customerName}
                      </b>
                      <span>{new Date(o.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p>{o.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</p>
                    <b>{money(o.total)}</b>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* In-Display Delete Confirmation Modal */}
      {deleteDialog && (
        <div className="overlay confirmOverlay" onMouseDown={(e) => e.target === e.currentTarget && setDeleteDialog(null)}>
          <div className="dialog confirmDialog">
            <div className="deleteIconWrap">
              <AlertTriangle size={32} color="#dc2626" />
            </div>
            <h3>{t('মুছে ফেলতে চান?', 'Confirm Delete?')}</h3>
            <p className="muted">
              {t(
                `আপনি কি নিশ্চিত যে "${deleteDialog.title}" মুছে ফেলবেন? এটি পার্মানেন্টলি ডিলিট হয়ে যাবে।`,
                `Are you sure you want to permanently delete "${deleteDialog.title}"? This cannot be undone.`
              )}
            </p>
            <div className="confirmActions">
              <button type="button" className="outline" onClick={() => setDeleteDialog(null)}>
                {t('বাতিল', 'Cancel')}
              </button>
              <button type="button" className="primary deleteBtnAction" disabled={busy} onClick={handleConfirmDelete}>
                {busy ? t('মুছে ফেলা হচ্ছে...', 'Deleting...') : t('হ্যাঁ, ডিলিট করুন', 'Yes, Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Continuous Ringing & Realtime Alert Popup */}
      {newOrderPopup && (
        <div className="overlay newOrderOverlay">
          <div className="dialog newOrderDialog">
            <div className="orderBell">
              <BellRing size={48} color="#087443" />
            </div>
            <h2>{t('নতুন অর্ডার এসেছে! 🔔', 'New Order Received! 🔔')}</h2>
            <p className="muted">
              {t('কাস্টমার:', 'Customer:')} <b>{newOrderPopup.customerName}</b> ({newOrderPopup.phone})
            </p>
            <div className="orderPriceHighlight">
              {money(newOrderPopup.total)}
            </div>
            <div className="orderItemsBrief">
              {newOrderPopup.items.map((item) => (
                <span key={item.id}>
                  {item.name} × {item.qty}
                </span>
              ))}
            </div>
            <div className="newOrderActions">
              <button
                type="button"
                className="outline"
                onClick={() => {
                  stopContinuousAlert();
                  setNewOrderPopup(null);
                }}
              >
                {t('শব্দ বন্ধ করুন', 'Mute Alert')}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  stopContinuousAlert();
                  setStatus(newOrderPopup, 'Accepted');
                }}
              >
                {t('Accept Order (গ্রহণ করুন)', 'Accept Order')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Layout Selector Modal */}
      {receiptOrder && (
        <div className="overlay receiptPickerOverlay" onMouseDown={(e) => e.target === e.currentTarget && setReceiptOrder(null)}>
          <div className="dialog receiptPicker">
            <button className="close" onClick={() => setReceiptOrder(null)}>
              <X />
            </button>
            <span className="eyebrow">PRINT LAYOUT</span>
            <h2>{t('রিসিটের অবস্থান নির্বাচন করুন', 'Choose receipt position')}</h2>
            <p className="muted">{t('A4 পেজে ৩টি লম্বা কলামের যেকোনো একটিতে রিসিট প্রিন্ট হবে।', 'Print one long, narrow receipt in one of the three A4 columns.')}</p>
            <div className="receiptPositions">
              {(['left', 'middle', 'right'] as const).map((pos) => (
                <button
                  type="button"
                  key={pos}
                  className={`receiptPosition ${receiptPosition === pos ? 'selected' : ''}`}
                  onClick={() => setReceiptPosition(pos)}
                >
                  <span className="paperPreview">
                    <i className={receiptPosition === pos ? 'paperActive' : ''}>
                      <b />
                      <b />
                      <b />
                      <b />
                      <b />
                    </i>
                  </span>
                  <strong>{t(pos === 'left' ? 'বাম' : pos === 'middle' ? 'মাঝখান' : 'ডান', pos[0].toUpperCase() + pos.slice(1))}</strong>
                </button>
              ))}
            </div>
            <div className="receiptPickerActions">
              <button className="outline" onClick={() => setReceiptOrder(null)}>
                {t('বাতিল', 'Cancel')}
              </button>
              <button className="primary" onClick={confirmPrintReceipt}>
                <Printer size={17} />
                {t('প্রিন্ট করুন', 'Print receipt')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Animated Action Toast */}
      {notice && (
        <div className="toast">
          <CheckCircle size={18} />
          {notice}
          <button onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </main>
  );
}

function OrderCard({ o, onPrint }: { o: Order; onPrint: (o: Order) => void }) {
  return (
    <div className="orderCard">
      <div className="orderTop">
        <b>Order #{o.id.slice(-7)}</b>
        <span className={`status ${o.status === 'Delivered' ? 'green' : o.status === 'Cancelled' ? 'red' : 'orange'}`}>{o.status}</span>
      </div>
      <small>{new Date(o.createdAt).toLocaleString()}</small>
      <p>{o.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</p>
      <div className="orderBottom">
        <b>{money(o.total)}</b>
        <button className="outline" onClick={() => onPrint(o)}>
          <Printer size={15} /> Receipt
        </button>
      </div>
    </div>
  );
}