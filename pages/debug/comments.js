import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export async function getServerSideProps() {
  const snapshot = await db
    .collection('triggered_comments')
    .orderBy('created_at', 'desc')
    .limit(20)
    .get();

  const comments = snapshot.docs.map(doc => doc.data());

  return { props: { comments } };
}

export default function DebugComments({ comments }) {
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
