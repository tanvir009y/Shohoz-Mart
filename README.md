# Shohoz Mart — Grocery shopping web app

Next.js 15 + Firebase Realtime Database / Authentication + Supabase Storage.

## 1) Install and run
```bash
npm install
cp .env.example .env.local
npm run dev
```
Open http://localhost:3000

## 2) Firebase setup
1. Firebase Console → Authentication → Sign-in method → enable **Email/Password** and **Google**.
2. Authentication → Settings → Authorized domains → add your deployed domain.
3. Realtime Database → Rules → paste `database.rules.json` and Publish.
4. Create a first admin account with the email `shohozmart247@gmail.com` using the normal Create account form. Admin access is determined by the verified Firebase account email, not by a client-side role field.
5. Ensure the admin email is verified before using admin features.

## 3) Supabase image storage
1. Supabase → Storage → create a public bucket named `shohoz-mart` (or change `NEXT_PUBLIC_SUPABASE_BUCKET`).
2. Bucket → Policies: allow public SELECT and authenticated/public INSERT/UPDATE/DELETE only if you accept public uploads. For production, use a Supabase Edge Function or server upload endpoint with strict admin authentication. This starter checks admin in the UI, but public anon keys are not a security boundary.
3. Put the bucket name in `.env.local`.

## 4) Data model
Realtime Database paths: `products`, `categories`, `banners`, `orders`, `users`.
Public visitors can read catalog. Signed-in customers can create and read their own orders. Admin email can manage catalog and orders. Guest checkout creates an order with uid `guest`; guests cannot read order history. Public guest-order creation can be abused, so production should move guest order creation behind a Firebase Cloud Function with validation and rate limiting.

## 5) Important production notes
- The Firebase and Supabase browser keys in `.env.local` are public client configuration, not secrets. Never put a Firebase service-account JSON or Supabase service-role key in browser code.
- Before launch, add server-side order validation/rate limiting and atomic stock reservation. Current stock is reduced when an admin marks an order Delivered and restored if a delivered order is later Cancelled; review this workflow before high-volume production.
- Set correct shop address, delivery coverage, policies, contact details and product catalogue.
- Receipt uses browser print; analysis statement downloads a PDF.
- Use HTTPS in production.

## Included
Responsive storefront, fuzzy product search, auto banner carousel, priority sorting, category filters, persistent cart, Bangla/English toggle, email/password + Google auth, checkout, customer order history, admin product/category/banner management, order status controls, printable long receipt, date-filtered delivered-order analysis and PDF statement.


## Updated database permissions (Google sign-in fix)
Import and publish the included `database.rules.json` in Firebase Realtime Database → Rules.
The root-level deny rules were removed because Realtime Database rules cascade and a root deny cannot be overridden by child rules.
Customer order history is stored under `userOrders/{uid}`; admin order management remains under `orders`.
