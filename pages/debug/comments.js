import { useEffect, useState } from 'react';

export default function DebugComments() {
  const [comments, setComments] = useState([]);

  useEffect(() => {
    fetch('/api/getComments')
      .then(res => res.json())
      .then(setComments)
      .catch(err => console.error('读取错误', err));
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 20 }}>
      <h1>🔥 Triggered Comments (最近 20 条)</h1>
      <ul>
        {comments.map((c, i) => (
          <li key={i} style={{ marginBottom: 10 }}>
            <b>{c.user_name || '匿名'}：</b> {c.message}<br />
            <small>ID: {c.comment_id}</small><br />
            <small>时间: {c.created_at}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
