// pages/order-review.js
import React from 'react';

export default function OrderReview() {
  const handleClick = async (endpoint) => {
    const res = await fetch(`/api/${endpoint}`);
    const data = await res.json();
    alert(data.message || JSON.stringify(data));
  };

  return (
    <main className="p-4 space-y-4">
      <h1 className="text-xl font-bold">订单操作面板</h1>

      <button
        className="bg-blue-600 text-white px-4 py-2 rounded-xl shadow"
        onClick={() => handleClick('startOrderListener')}
      >
        📌 记录商品资料
      </button>

      <button
        className="bg-yellow-600 text-white px-4 py-2 rounded-xl shadow"
        onClick={() => handleClick('confirmAllOrders')}
      >
        ✅ 写入所有订单
      </button>

      <button
        className="bg-green-600 text-white px-4 py-2 rounded-xl shadow"
        onClick={() => handleClick('exportOrders')}
      >
        📤 导出已付款订单
      </button>
    </main>
  );
}
