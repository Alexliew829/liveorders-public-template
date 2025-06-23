// pages/order-review.js
import { useEffect, useState } from 'react';

export default function OrderReviewPage() {
  const [comments, setComments] = useState([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch('/api/debugComments')
      .then(res => res.json())
      .then(data => setComments(data.comments || []));
  }, []);

  const handleConfirm = async (comment) => {
    setStatus(`处理 ${comment.comment_id} 中...`);
    try {
      const res = await fetch('/api/manualConfirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_id: comment.comment_id })
      });
      const result = await res.json();
      if (res.ok) {
        setStatus(`✅ ${result.selling_id} 写入成功`);
      } else {
        setStatus(`❌ 跳过：${result.skip || result.error}`);
      }
    } catch (err) {
      setStatus('❌ 网络错误');
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h2>📝 顾客留言审核</h2>
      <p>点击按钮确认某条留言为下单，将写入 triggered_comments。</p>
      {comments.map((c) => (
        <div key={c.comment_id} style={{ marginBottom: '1rem', borderBottom: '1px solid #ccc', paddingBottom: '0.5rem' }}>
          <p><strong>{c.from?.name || '匿名用户'}</strong>：{c.message}</p>
          <button onClick={() => handleConfirm(c)} style={{ padding: '0.5rem 1rem', backgroundColor: '#1976d2', color: '#fff', border: 'none', borderRadius: '4px' }}>
            ✅ 确认为下单
          </button>
        </div>
      ))}
      <p style={{ marginTop: '2rem', fontWeight: 'bold' }}>{status}</p>
    </div>
  );
}
