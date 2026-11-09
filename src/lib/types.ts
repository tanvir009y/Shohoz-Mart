export interface Product {
  id: string;
  name: string;
  nameBn?: string;
  price: number;
  discountPrice?: number; // নতুন ডিসকাউন্ট প্রাইস
  stock: number;
  description?: string;
  categoryId: string;
  priority?: number;
  image?: string;
  active?: boolean;
}

export type Category = {
  id: string;
  name: string;
  nameBn?: string;
  image?: string;
  priority?: number;
};

export type Banner = {
  id: string;
  image: string;
  title?: string;
  priority?: number;
  active?: boolean;
};

export interface OrderItem {
  id: string;
  name: string;
  originalPrice: number;
  price: number; // কার্যকর প্রাইস (যদি ডিসকাউন্ট থাকে)
  qty: number;
  image?: string;
}

export type Order = {
  id: string;
  uid: string;
  customerName: string;
  phone: string;
  city: string;
  street: string;
  apartment?: string;
  note?: string;
  items: OrderItem[];
  subtotal: number;
  delivery: number;
  discountTotal?: number; // অর্ডারের মোট ডিসকাউন্ট হিসাব
  total: number;
  status: 'Pending' | 'Accepted' | 'Delivered' | 'Cancelled';
  createdAt: number;
  updatedAt?: number;
};
