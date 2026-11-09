export type Product = {id:string;name:string;nameBn?:string;price:number;description?:string;image?:string;stock:number;categoryId?:string;categoryName?:string;priority?:number;active?:boolean};
export type Category = {id:string;name:string;nameBn?:string;image?:string;priority?:number};
export type Banner = {id:string;image:string;title?:string;priority?:number;active?:boolean};
export type OrderItem = {id:string;name:string;price:number;qty:number;image?:string};
export type Order = {id:string;uid:string;customerName:string;phone:string;city:string;street:string;apartment?:string;note?:string;items:OrderItem[];subtotal:number;delivery:number;total:number;status:'Pending'|'Accepted'|'Delivered'|'Cancelled';createdAt:number;updatedAt?:number};
