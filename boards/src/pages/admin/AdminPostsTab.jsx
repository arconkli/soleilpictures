// AdminPostsTab.jsx — the desktop admin's Posts tab: the phone panel's Posts
// screen (phone/PhonePosts.jsx) in a centred column, so the TikTok posts are
// in the admin on any screen. Files and Posted go through the same admin-only
// proxy (phone/postsApi.js). Lazy: it loads only when its tab opens.
import { useState } from 'react';
import './phone/adminPhone.css';
import { PhonePosts } from './phone/PhonePosts.jsx';

export function AdminPostsTab({ api, onBadge }) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="ap ap-desk">
      <div className="ap-desk-top">
        <h1>Posts</h1>
        <button type="button" className="ap-btn" onClick={() => setRefreshKey((k) => k + 1)}>Refresh</button>
      </div>
      <PhonePosts refreshKey={refreshKey} api={api} onBadge={onBadge} />
    </div>
  );
}
