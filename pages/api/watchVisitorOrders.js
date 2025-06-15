export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只接受 POST 请求' });
  }

  let { post_id } = req.body;

  if (!post_id || post_id === 'latest') {
    // 如果是最新帖文，自动获取最新的 post_id
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    post_id = postData?.data?.[0]?.id;
  }

  if (!post_id) {
    return res.status(400).json({ error: '缺少 post_id 参数' });
  }

  try {
    // 启动顾客留言监听逻辑

    return res.status(200).json({ success: true, post_id });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
