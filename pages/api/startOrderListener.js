export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // 获取最新帖文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    // 启动监听主页留言的逻辑

    return res.status(200).json({ success: true, post_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
