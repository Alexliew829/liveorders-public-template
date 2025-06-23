// pages/confirm-orders.js
import { useState } from 'react';

export default function ConfirmOrdersPage() {
  const [status, setStatus] = useState('');

  const handleConfirm = async () => {
    setStatus('处理中...');
    try {
      const res = await fetch('/api/confirmAllOrders', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setStatus(`✅ 成功写入 ${data.success} 条订单，跳过 ${data.skipped} 条`);
      } else {
        setStatus(`❌ 错误：${data.error}`);
      }
    } catch (err) {
      setStatus('❌ 网络错误或服务器未响应');
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h2>📦 一键写入顾客下单记录</h2>
      <p>点击按钮后，系统将把所有有效留言从 debug_comments 写入 triggered_comments。</p>
      <button
        onClick={handleConfirm}
        style={{ padding: '1rem 2rem', fontSize: '1.1rem', borderRadius: '8px', backgroundColor: '#2e7d32', color: 'white', border: 'none' }}
      >
        ✅ 确认所有留言为下单
      </button>
      <p style={{ marginTop: '1.5rem', fontWeight: 'bold' }}>{status}</p>
    </div>
  );
}
