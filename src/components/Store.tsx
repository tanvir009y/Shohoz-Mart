'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from 'firebase/auth';
import { onValue, ref, push, set, update, remove, runTransaction } from 'firebase/database';
import { auth, db, googleProvider, ADMIN_EMAIL } from '@/lib/firebase';
import { uploadImage } from '@/lib/supabase';
import type { Product, Category, Banner, Order } from '@/lib/types';
import { Search, ShoppingCart, User, LogOut, Plus, Minus, X, Globe, Printer, FileDown, CheckCircle, Trash2, Pencil, AlertTriangle, BellRing, Settings as SettingsIcon } from 'lucide-react';

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

let loopAudio: HTMLAudioElement | null = null;

function generateRingToneUri() {
  const sampleRate = 8000;
  const duration = 2.4;
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
  writeUint16(20, 1);
  writeUint16(22, 1);
  writeUint32(24, sampleRate);
  writeUint32(28, sampleRate);
  writeUint16(32, 1);
  writeUint16(34, 8);
  writeString(36, 'data');
  writeUint32(40, totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = 128;
    if (t < 0.25) sample += Math.sin(2 * Math.PI * 784 * t) * 70;
    else if (t >= 0.28 && t < 0.55) sample += Math.sin(2 * Math.PI * 1046 * t) * 75;
    else if (t >= 0.60 && t < 1.05) {
      const fade = 1 - (t - 0.60) / 0.45;
      sample += Math.sin(2 * Math.PI * 1318 * t) * 70 * Math.max(0, fade);
    }
    buffer[44 + i] = Math.max(0, Math.min(255, Math.floor(sample)));
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function startContinuousAlert() {
  try {
    if (!loopAudio) {
      loopAudio = new Audio(generateRingToneUri());
      loopAudio.loop = true;
    }
    loopAudio.currentTime = 0;
    loopAudio.play().catch(() => {});
  } catch (err) {}
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

  // অ্যাডমিন কর্তৃক সেট করা ডেলিভারি চার্জ
  const [deliveryCharge, setDeliveryCharge] = useState<number>(40);
  const [deliveryChargeInput, setDeliveryChargeInput] = useState<string>('40');

  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
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
  const [adminTab, setAdminTab] = useState<'orders' | 'products' | 'categories' | 'banners' | 'analysis' | 'settings'>('orders');

  const [editProduct, setEditProduct] = useState<any>(null);
  const [editCategory, setEditCategory] = useState<any>(null);
  const [editBanner, setEditBanner] = useState<any>(null);

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    type: 'product' | 'category' | 'banner';
    id: string;
    title: string;
  } | null>(null);

  const [newOrderPopup, setNewOrderPopup] = useState<Order | null>(null);
  const isFirstOrdersLoad = useRef(true);

  const [analysisFrom, setAnalysisFrom] = useState('');
  const [analysisTo, setAnalysisTo] = useState('');
  const [flyingProduct, setFlyingProduct] = useState<string | null>(null);
  const [cartJump, setCartJump] = useState(false);
  const [flightPoint, setFlightPoint] = useState<{ x: number; y: number } | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptPosition, setReceiptPosition] = useState<'left' | 'middle' | 'right'>('middle');

  // প্রোডাক্ট ডিসকাউন্ট টগল
  const [hasDiscount, setHasDiscount] = useState<boolean>(false);
  const [productForm, setProductForm] = useState<any>({
    name: '',
    nameBn: '',
    price: '',
    discountPrice: '',
    stock: '',
    description: '',
    categoryId: '',
    priority: 0,
  });
  const [categoryForm, setCategoryForm] = useState<any>({ name: '', nameBn: '', priority: 0 });
  const [bannerForm, setBannerForm] = useState<any>({ title: '', priority: 0 });

  const isAdmin = (user?.email || '').trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
  const t = (bn: string, en: string) => (lang === 'bn' ? bn : en);

  useEffect(() => {
    return onValue(ref(db, 'settings/deliveryCharge'), (snap) => {
      const val = snap.val();
      if (val !== null && val !== undefined) {
        setDeliveryCharge(Number(val));
        setDeliveryChargeInput(String(val));
      }
    });
  }, []);

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

      if (isFirstOrdersLoad.current) {
        isFirstOrdersLoad.current = false;
        return;
      }

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

  // লাইভ সার্চ সাজেশনস
  const searchSuggestions = useMemo(() => {
    if (!search.trim()) return [];
    return products
      .filter((p) => p.active !== false && (fuzzy(p.name, search) || fuzzy(p.nameBn || '', search)))
      .slice(0, 6);
  }, [products, search]);

  const cartRows = products
    .filter((p) => cart[p.id] > 0)
    .map((p) => {
      const effectivePrice = p.discountPrice && p.discountPrice > 0 ? Number(p.discountPrice) : Number(p.price);
      return {
        ...p,
        originalPrice: Number(p.price),
        effectivePrice,
        qty: cart[p.id],
      };
    });

  const subtotal = cartRows.reduce((s, p) => s + p.effectivePrice * p.qty, 0);
  const totalRegularPrice = cartRows.reduce((s, p) => s + p.originalPrice * p.qty, 0);
  const discountTotal = Math.max(0, totalRegularPrice - subtotal);

  // ৪৯৯ টাকা বা বেশি হলে ফ্রি ডেলিভারি
  const isFreeDelivery = subtotal >= 499;
  const actualDelivery = isFreeDelivery ? 0 : cartRows.length ? deliveryCharge : 0;
  const total = subtotal + actualDelivery;
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

  // সাজেশনে ক্লিক করলে সরাসরি ঐ প্রোডাক্ট কার্ডে স্ক্রোল করা
  const selectSuggestion = (product: Product) => {
    setSearch(product.name);
    setIsSearchFocused(false);
    setCategory('all');
    setTimeout(() => {
      const el = document.querySelector(`[data-product-id="${product.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlightProduct');
        setTimeout(() => el.classList.remove('highlightProduct'), 2200);
      }
    }, 150);
  };

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
        items: cartRows.map((p) => ({
          id: p.id,
          name: p.name,
          originalPrice: p.originalPrice,
          price: p.effectivePrice,
          qty: p.qty,
          image: p.image || '',
        })),
        subtotal,
        discountTotal,
        delivery: actualDelivery,
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

      const payload: any = {
        name: productForm.name,
        nameBn: productForm.nameBn || '',
        price: Number(productForm.price),
        stock: Number(productForm.stock),
        priority: Number(productForm.priority) || 0,
        description: productForm.description || '',
        categoryId: productForm.categoryId || '',
        image,
        active: true,
      };

      if (hasDiscount && productForm.discountPrice) {
        payload.discountPrice = Number(productForm.discountPrice);
      } else {
        payload.discountPrice = null;
      }

      await set(ref(db, `products/${id}`), payload);
      setEditProduct(null);
      setHasDiscount(false);
      setProductForm({ name: '', nameBn: '', price: '', discountPrice: '', stock: '', description: '', categoryId: '', priority: 0 });
      const fileInput = document.getElementById('product-image') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      setNotice(t('পণ্য সফলভাবে সংরক্ষিত হয়েছে! ✨', 'Product successfully saved! ✨'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /* Admin Category Save / Update with Image Upload */
  async function saveCategory(e: any) {
    e.preventDefault();
    setBusy(true);
    try {
      let image = editCategory?.image || '';
      const file = (document.getElementById('category-image') as HTMLInputElement)?.files?.[0];
      if (file) {
        image = await uploadImage(file, 'categories');
      }

      const id = editCategory?.id || push(ref(db, 'categories')).key!;
      await set(ref(db, `categories/${id}`), {
        ...categoryForm,
        image,
        priority: Number(categoryForm.priority) || 0,
        active: true,
      });

      setEditCategory(null);
      setCategoryForm({ name: '', nameBn: '', priority: 0 });
      const fileInput = document.getElementById('category-image') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

      setNotice(t('ক্যাটাগরি সংরক্ষিত হয়েছে! ✨', 'Category successfully saved! ✨'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
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

  /* Delivery Charge Settings Save */
  async function saveDeliverySettings(e: any) {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    try {
      const fee = Number(deliveryChargeInput);
      await set(ref(db, 'settings/deliveryCharge'), fee);
      setDeliveryCharge(fee);
      setNotice(t('ডেলিভারি চার্জ সফলভাবে আপডেট হয়েছে! 🚚', 'Delivery charge successfully updated! 🚚'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

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

  // মানি রিসিট প্রিন্ট ফাংশন (টেবিলে মূল দাম, নিচে ডিসকাউন্ট বিয়োগ ও মোট প্রদেয়)
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

    // প্রতিটি আইটেমের মূল দাম (Original Price) দিয়ে আসল সাবটোটাল
    const originalSubtotal = o.items.reduce((s, it) => s + (it.originalPrice || it.price) * it.qty, 0);
    const orderDiscount = o.discountTotal !== undefined && o.discountTotal > 0 ? o.discountTotal : Math.max(0, originalSubtotal - o.subtotal);
    const deliveryText = o.delivery === 0 ? 'Free (৳০)' : money(o.delivery);

    w.document.write(`<html><head><title>Shohoz Mart Receipt</title><style>
      @page{size:A4 portrait;margin:0}*{box-sizing:border-box}
      html,body{margin:0;padding:0;font-family:'Hind Siliguri',Arial,sans-serif;color:#000}
      body{width:210mm;height:297mm}
      .sheet{width:210mm;height:297mm;padding:2mm;display:grid;grid-template-columns:repeat(3,1fr);gap:1mm}
      .slot{height:293mm;min-width:0;display:flex;align-items:flex-start;justify-content:center;overflow:hidden}
      .receipt{width:100%;height:293mm;padding:4mm 3mm;border:1px dashed #666;font-size:8.5pt;display:flex;flex-direction:column;overflow:hidden}
      .brandHeader{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:2mm}
      .brandIconBox{width:24px;height:24px;background:#000;color:#fff;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px}
      .brandTitle{font-size:16pt;font-weight:800;margin:0;letter-spacing:-0.5px}
      .subHeader{text-align:center;font-size:7.5pt;color:#333;margin:0 0 2mm}
      .receiptPill{display:inline-block;padding:2px 14px;border:1.5px solid #000;border-radius:20px;font-weight:700;font-size:9pt;margin:1mm auto 2.5mm}
      .pillsWrap{text-align:center;position:relative;margin:2mm 0}
      .pillsWrap:before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:#000;z-index:-1}
      .pillsWrap span{background:#fff;padding:0 8px}
      .metaInfo{font-size:7.5pt;line-height:1.45;margin-bottom:2mm}
      table{width:100%;font-size:8pt;border-collapse:collapse;margin:2mm 0}
      th{border-top:1.5px solid #000;border-bottom:1.5px solid #000;padding:3px 1px;text-align:left;font-weight:bold}
      td{padding:4px 1px;border-bottom:1px dotted #ccc;vertical-align:top}
      .r{text-align:right}.c{text-align:center}
      .dashLine{border-top:1px dashed #000;margin:2mm 0}
      .summaryRow{display:flex;justify-content:space-between;padding:1.5px 0;font-size:8pt}
      .boldSummary{font-weight:800;font-size:9.5pt;border-top:1.5px solid #000;border-bottom:1.5px solid #000;padding:3px 0;margin:2px 0}
      .thanks{text-align:center;font-size:8pt;font-weight:bold;margin:3mm 0 2mm}
      .qrWrap{text-align:center;margin-top:auto;padding-bottom:3mm}
      .qrWrap img{width:75px;height:75px}
      .blank{visibility:hidden}
      @media screen{body{background:#e9ece9}.sheet{margin:10px auto;background:#fff;box-shadow:0 2px 15px #0002}}
    </style></head><body><div class="sheet">
      ${[0, 1, 2]
        .map(
          (i) => `<div class="slot">${
            i === column
              ? `<section class="receipt">
          <div class="brandHeader">
            <span class="brandIconBox">S</span>
            <span class="brandTitle">Shohoz Mart</span>
          </div>
          <p class="subHeader">Mymensingh Sadar<br/>www.facebook.com/shohozmart | Helpline: 01822211566</p>
          <div class="pillsWrap"><span><div class="receiptPill">মানি রিসিট</div></span></div>
          <div class="metaInfo">
            <div><b>Date:</b> ${new Date(o.createdAt).toLocaleDateString('en-GB')}, ${new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · <b>No.</b> ${safe(o.id.slice(-6))}</div>
            <div><b>Customer Phone:</b> ${safe(o.phone)}</div>
            <div><b>Address:</b> ${safe(o.city)}, ${safe(o.street)} ${safe(o.apartment || '')}</div>
          </div>
          <table>
            <tr><th style="width:45%">পণ্য</th><th class="c" style="width:20%">দাম</th><th class="c" style="width:15%">পরিমাণ</th><th class="r" style="width:20%">মোট</th></tr>
            ${o.items
              .map((it, idx) => {
                const itemOriginal = it.originalPrice || it.price;
                return `<tr>
                  <td>${idx + 1}. ${safe(it.name)}</td>
                  <td class="c">${safe(money(itemOriginal))}</td>
                  <td class="c">${safe(it.qty)}</td>
                  <td class="r">${safe(money(itemOriginal * it.qty))}</td>
                </tr>`;
              })
              .join('')}
          </table>
          <div class="summaryRow boldSummary">
            <span>সর্বমোট</span>
            <span>${safe(money(originalSubtotal))}</span>
          </div>
          ${orderDiscount > 0 ? `<div class="summaryRow"><span>ডিসকাউন্ট</span><span>- ${safe(money(orderDiscount))}</span></div>` : ''}
          <div class="summaryRow">
            <span>ডেলিভারি চার্জ</span>
            <span>${safe(deliveryText)}</span>
          </div>
          <div class="summaryRow boldSummary" style="font-size:10.5pt">
            <span>মোট প্রদেয়</span>
            <span>${safe(money(o.total))}</span>
          </div>
          ${
            orderDiscount > 0
              ? `<div class="dashLine"></div>
                 <div class="summaryRow"><b>ডিসকাউন্ট পণ্য:</b></div>
                 <div class="summaryRow" style="font-size:7.5pt"><span>অতিরিক্ত ছাড়</span><span>${safe(money(orderDiscount))}</span></div>
                 <div class="summaryRow" style="font-weight:bold;margin-top:1mm"><span>সর্বমোট ডিসকাউন্ট</span><span>${safe(money(orderDiscount))}</span></div>`
              : ''
          }
          <p class="thanks">Shohoz Mart এ কেনাকাটা করার জন্য আপনাকে ধন্যবাদ!</p>
          <div class="qrWrap">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://www.facebook.com/shohozmart" alt="QR" />
          </div>
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
    const w = window.open('', '_blank', 'width=900,height=900');
    if (!w) return;
    const safe = (v: any) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
    const grand = delivered.reduce((s, o) => s + o.total, 0);

    w.document.write(`<html><head><title>Shohoz Mart Statement</title><style>
      body{font-family:'Hind Siliguri',Arial,sans-serif;padding:30px;color:#17251d}
      .head{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #087443;padding-bottom:15px;margin-bottom:20px}
      .brand{font-size:26px;font-weight:800;color:#087443;display:flex;align-items:center;gap:10px}
      .brandBox{width:36px;height:36px;background:#087443;color:#fff;display:inline-grid;place-items:center;border-radius:8px;font-size:20px}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th,td{border:1px solid #dce9df;padding:10px;text-align:left;font-size:12px}
      th{background:#f1f8ee;color:#075b36;font-weight:bold}
      .r{text-align:right}
      .grandRow{font-size:14px;font-weight:bold;background:#fafefa}
    </style></head><body>
      <div class="head">
        <div class="brand"><span class="brandBox">S</span> Shohoz Mart</div>
        <div>
          <h2 style="margin:0;font-size:18px;color:#075b36">অর্ডার স্টেটমেন্ট (ডেলিভার্ড)</h2>
          <small>তারিখ: ${safe(analysisFrom || 'শুরু')} থেকে ${safe(analysisTo || 'বর্তমান')} · মোট অর্ডার: ${delivered.length}</small>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>তারিখ</th>
            <th>অর্ডার আইডি</th>
            <th>গ্রাহকের নাম</th>
            <th>মোবাইল নম্বর</th>
            <th>পণ্যের বিবরণ</th>
            <th class="r">মোট টাকা</th>
          </tr>
        </thead>
        <tbody>
          ${delivered
            .map(
              (o) => `<tr>
            <td>${new Date(o.createdAt).toLocaleDateString('bn-BD')}</td>
            <td>#${safe(o.id.slice(-7))}</td>
            <td>${safe(o.customerName)}</td>
            <td>${safe(o.phone)}</td>
            <td>${safe(o.items.map((i) => `${i.name} x${i.qty}`).join(', '))}</td>
            <td class="r">${safe(money(o.total))}</td>
          </tr>`
            )
            .join('')}
          <tr class="grandRow">
            <td colspan="5" class="r">সর্বমোট বিক্রয়:</td>
            <td class="r">${safe(money(grand))}</td>
          </tr>
        </tbody>
      </table>
      <script>window.onload=()=>{window.focus();window.print()}</script>
    </body></html>`);
    w.document.close();
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

      {/* ১. Search Bar একদম উপরে স্থানান্তর করা হলো লাইভ সাজেশনসহ */}
      <section className="searchWrap">
        <Search size={20} />
        <input
          value={search}
          onFocus={() => setIsSearchFocused(true)}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsSearchFocused(true);
          }}
          placeholder={t('পণ্যের নাম লিখে খুঁজুন...', 'Search products...')}
        />
        {search && (
          <button
            onClick={() => {
              setSearch('');
              setIsSearchFocused(false);
            }}
          >
            <X size={17} />
          </button>
        )}

        {/* সার্চ সাজেশনস ড্রপডাউন */}
        {isSearchFocused && searchSuggestions.length > 0 && (
          <div className="searchSuggestions">
            {searchSuggestions.map((prod) => (
              <div
                key={prod.id}
                className="suggestionItem"
                onMouseDown={() => selectSuggestion(prod)}
              >
                <div className="suggestionPic">
                  {prod.image ? <img src={prod.image} alt={prod.name} /> : '🥦'}
                </div>
                <div className="suggestionDetails">
                  <b>{lang === 'bn' ? prod.nameBn || prod.name : prod.name}</b>
                  <small>
                    {money(prod.discountPrice && prod.discountPrice > 0 ? prod.discountPrice : prod.price)}
                    {prod.discountPrice && prod.discountPrice > 0 && (
                      <span className="suggestionOldPrice">{money(prod.price)}</span>
                    )}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Hero Section */}
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
              <span>{c.image ? <img src={c.image} alt={c.name} /> : '🥗'}</span>
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

            const hasDiscountPrice = p.discountPrice && p.discountPrice > 0 && p.discountPrice < p.price;
            const discountPercent = hasDiscountPrice ? Math.round(((p.price - p.discountPrice!) / p.price) * 100) : 0;

            return (
              <article className="product" key={p.id} data-product-id={p.id}>
                <div className="productPic">
                  {p.image ? <img src={p.image} alt={displayName} /> : <div className="placeholder">🥦</div>}
                  <span className={`stock ${p.stock > 0 ? 'in' : 'out'}`}>
                    {p.stock > 0 ? `${t('স্টক', 'Stock')}: ${p.stock}` : t('স্টক শেষ', 'Out of stock')}
                  </span>
                  {hasDiscountPrice && (
                    <span className="discountBadge">{discountPercent}% OFF</span>
                  )}
                </div>
                <div className="productInfo">
                  <small className="catBadge">{categories.find((c) => c.id === p.categoryId)?.name || 'Grocery'}</small>
                  <h3 title={displayName}>{displayName}</h3>
                  <p title={displayDesc}>{displayDesc}</p>
                  <div className="productBottom">
                    <div className="priceGroup">
                      {hasDiscountPrice ? (
                        <>
                          <strong>{money(p.discountPrice!)}</strong>
                          <span className="oldPrice">{money(p.price)}</span>
                        </>
                      ) : (
                        <strong>{money(p.price)}</strong>
                      )}
                    </div>
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

      {/* Footer */}
      <footer>
        <div>
          <b>Shohoz Mart</b>
          <div style={{ marginTop: '4px' }}>
            <span>Mymensingh Sadar · Helpline: 01822211566 · </span>
            <a className="footerSocial" href="https://www.facebook.com/shohozmart" target="_blank" rel="noopener noreferrer">
              facebook.com/shohozmart
            </a>
          </div>
        </div>
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
                          {money(p.effectivePrice)} × {p.qty}
                          {p.originalPrice > p.effectivePrice && (
                            <span style={{ textDecoration: 'line-through', marginLeft: '6px', color: '#999' }}>
                              {money(p.originalPrice)}
                            </span>
                          )}
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
                      <b>{money(p.effectivePrice * p.qty)}</b>
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
                    {discountTotal > 0 && (
                      <div style={{ color: '#087443' }}>
                        <span>{t('মোট ডিসকাউন্ট', 'Total Discount')}</span>
                        <b>- {money(discountTotal)}</b>
                      </div>
                    )}
                    <div>
                      <span>
                        {t('ডেলিভারি চার্জ', 'Delivery charge')}
                        {isFreeDelivery && <span className="freeDeliveryNotice">৳৪৯৯+ ফ্রি ডেলিভারি</span>}
                      </span>
                      <b>{isFreeDelivery ? <span style={{ color: '#087443' }}>ফ্রি</span> : money(actualDelivery)}</b>
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
                ['settings', 'Settings'],
              ].map(([k, v]) => (
                <button
                  key={k}
                  className={adminTab === k ? 'active' : ''}
                  onClick={() => {
                    setAdminTab(k as any);
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
                      placeholder="Regular Price (৳)"
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

                  <label className="discountCheckWrap">
                    <input
                      type="checkbox"
                      checked={hasDiscount}
                      onChange={(e) => {
                        setHasDiscount(e.target.checked);
                        if (!e.target.checked) setProductForm({ ...productForm, discountPrice: '' });
                      }}
                    />
                    <span>ডিসকাউন্ট (Discount) দিতে চান?</span>
                  </label>

                  {hasDiscount && (
                    <input
                      type="number"
                      min="0"
                      required
                      placeholder="Discount Price (৳) - ছাড়ের পর দাম"
                      value={productForm.discountPrice}
                      onChange={(e) => setProductForm({ ...productForm, discountPrice: e.target.value })}
                    />
                  )}

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
                          setHasDiscount(false);
                          setProductForm({ name: '', nameBn: '', price: '', discountPrice: '', stock: '', description: '', categoryId: '', priority: 0 });
                          const fileInput = document.getElementById('product-image') as HTMLInputElement;
                          if (fileInput) fileInput.value = '';
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
                          {p.discountPrice ? (
                            <>
                              <b style={{ color: '#087443' }}>{money(p.discountPrice)}</b>{' '}
                              <span style={{ textDecoration: 'line-through' }}>{money(p.price)}</span>
                            </>
                          ) : (
                            money(p.price)
                          )}{' '}
                          · Stock {p.stock}
                        </small>
                      </div>
                      <button
                        className="outline"
                        title="Edit"
                        onClick={() => {
                          setEditProduct(p);
                          setHasDiscount(Boolean(p.discountPrice && p.discountPrice > 0));
                          setProductForm({ ...p, discountPrice: p.discountPrice || '' });
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
                    placeholder="Priority (Higher shows first)"
                    value={categoryForm.priority}
                    onChange={(e) => setCategoryForm({ ...categoryForm, priority: e.target.value })}
                  />

                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--muted)' }}>
                    Category Icon / Image:
                  </label>
                  <input id="category-image" type="file" accept="image/*" />

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="primary" disabled={busy}>
                      {busy ? 'Saving...' : editCategory ? 'Update category' : 'Add category'}
                    </button>
                    {editCategory && (
                      <button
                        type="button"
                        className="outline"
                        onClick={() => {
                          setEditCategory(null);
                          setCategoryForm({ name: '', nameBn: '', priority: 0 });
                          const fileInput = document.getElementById('category-image') as HTMLInputElement;
                          if (fileInput) fileInput.value = '';
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>

                <div className="adminList">
                  {categories.map((c) => (
                    <div className="manageRow" key={c.id}>
                      <div className="miniPic">
                        {c.image ? <img src={c.image} alt={c.name} /> : '🥗'}
                      </div>
                      <div className="grow">
                        <b>
                          {c.name} {c.nameBn && `/ ${c.nameBn}`}
                        </b>
                        <small>Priority: {c.priority || 0}</small>
                      </div>
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
                </div>
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
                          const fileInput = document.getElementById('banner-image') as HTMLInputElement;
                          if (fileInput) fileInput.value = '';
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
                    <FileDown size={16} /> স্টেটমেন্ট প্রিন্ট (বাংলা)
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

            {/* Settings Tab */}
            {adminTab === 'settings' && (
              <form className="adminForm" onSubmit={saveDeliverySettings}>
                <h3>
                  <SettingsIcon size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                  ডেলিভারি চার্জ নির্ধারণ (Delivery Charge Settings)
                </h3>
                <p className="muted">
                  এখানে নির্ধারিত ডেলিভারি ফি সব কাস্টমারের অর্ডারে প্রযোজ্য হবে (৳৪৯৯ বা তার বেশি অর্ডারে স্বয়ংক্রিয়ভাবে ফ্রি থাকবে)।
                </p>
                <div style={{ maxWidth: '300px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold' }}>স্ট্যান্ডার্ড ডেলিভারি ফি (৳):</label>
                  <input
                    type="number"
                    min="0"
                    required
                    style={{ marginTop: '6px' }}
                    value={deliveryChargeInput}
                    onChange={(e) => setDeliveryChargeInput(e.target.value)}
                  />
                </div>
                <div>
                  <button className="primary" disabled={busy}>
                    {busy ? 'আপডেট হচ্ছে...' : 'ডেলিভারি চার্জ সেভ করুন'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
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

      {/* Realtime Alert Modal */}
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

      {/* Receipt Position Picker Modal */}
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

      {/* Action Toast */}
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
