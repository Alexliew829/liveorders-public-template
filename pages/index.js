import Head from 'next/head'

export default function Home() {
  const handleClick = async () => {
    try {
      const res = await fetch('/api/startOrderListener', { method: 'POST' });
      const data = await res.json();
      alert(data.success ? '✅ 已启动监听系统！' : `❌ 启动失败：${data.error}`);
    } catch (err) {
      alert('❌ 网络错误，请重试');
    }
  };

  return (
    <>
      <Head>
        <title>启动监听系统</title>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 100 }}>
        <img src="/apple-touch-icon.png" alt="logo" style={{ width: 120, borderRadius: 28, marginBottom: 40 }} />
        <button
          onClick={handleClick}
          style={{
            backgroundColor: '#2E7D32',
            color: 'white',
            padding: '16px 32px',
            border: 'none',
            borderRadius: 16,
            fontSize: 20,
            fontWeight: 'bold',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}
        >
          📡 启动监听系统
        </button>
      </main>
    </>
  );
}
