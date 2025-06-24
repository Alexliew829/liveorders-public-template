const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
const postData = await postRes.json();
const post_id = postData?.data?.[0]?.id;
if (!post_id) throw new Error('无法获取贴文 ID');

// 获取留言
const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
const commentData = await commentRes.json();
const comments = commentData?.data || [];

console.log('共获取留言数：', comments.length); // 添加调试

let count = 0;

for (const c of comments) {
  if (c.from?.id === PAGE_ID) continue; // 跳过主播留言
  const message = c.message || '';
  const match = message.match(/\b([ABab])\s?0*(\d{1,3})\b/);
  if (!match) continue;

  const selling_id = `${match[1].toUpperCase()}${match[2].padStart(3, '0')}`;
  const comment_id = c.id;
  const user_id = c.from?.id;
  const user_name = c.from?.name || '';

  const ref = db.collection('triggered_comments').doc(comment_id);
  const exists = await ref.get();
  if (exists.exists) continue;

  await ref.set({
    comment_id,
    post_id,
    selling_id,
    message,
    user_id,
    user_name,
    created_time: new Date().toISOString(),
  });

  count++;
}
