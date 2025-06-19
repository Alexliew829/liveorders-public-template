export default function TestPage() {
  const handleTest = async () => {
    const res = await fetch('/api/Testing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment_id: 'test_' + Date.now(),
        post_id: 'post_001',
        message: '这是网页测试留言',
        from: { id: 'user_123', name: '网页测试用户' }
      })
    });

    const result = await res.json();
    alert(JSON.stringify(result, null, 2));
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 30 }}>
      <h2>🧪 Testing.js 写入 Firebase</h2>
      <button
        onClick={handleTest}
        style={{
          padding: '10px 20px',
          fontSize: 18,
          cursor: 'pointer',
          backgroundColor: '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: 8
        }
