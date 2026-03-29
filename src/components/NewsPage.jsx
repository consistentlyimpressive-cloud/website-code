import React, { useState, useEffect } from 'react';
import { Play, ExternalLink, Loader2, TrendingUp, Clock, Youtube, MessageSquare, Newspaper } from 'lucide-react';

// A mix of channels related to facial aesthetics, looksmaxxing, and self-improvement
const TARGET_CHANNELS = [
  'UCk8JzO451QvD1pU21m0A3rQ', // QOVES Studio
  'UC4LgBfA1P_g21eC1Yx21Q9w', // Wheat Waffles
  'UC17tS-xT2i4X7L2B_bO7yQw', // Dillon Latham
];

const FEATURED_VIDEOS = [
  {
    title: "Finding Your Perfect Hairstyle Is Surprisingly Easy",
    author: "QOVES Studio",
    pubDate: "2023-05-14T00:00:00.000Z",
    thumbnail: "https://i.ytimg.com/vi/yfk0c18xPcE/maxresdefault.jpg",
    link: "https://www.youtube.com/watch?v=yfk0c18xPcE"
  },
  {
    title: "What Type Of Eyes Do You Have?",
    author: "QOVES Studio",
    pubDate: "2023-08-20T00:00:00.000Z",
    thumbnail: "https://i.ytimg.com/vi/1wUjJjMMVaI/maxresdefault.jpg",
    link: "https://www.youtube.com/watch?v=1wUjJjMMVaI"
  },
  {
    title: "The Jawline - Analysing the Perfect Male Face (Part 1/4)",
    author: "Wheat Waffles",
    pubDate: "2022-02-05T00:00:00.000Z",
    thumbnail: "https://i.ytimg.com/vi/ZhEuWSXxu5k/maxresdefault.jpg",
    link: "https://www.youtube.com/watch?v=ZhEuWSXxu5k"
  },
  {
    title: "Midface and Nose - Analysing the Perfect Male Face (Part 2/4)",
    author: "Wheat Waffles",
    pubDate: "2022-03-02T00:00:00.000Z",
    thumbnail: "https://i.ytimg.com/vi/qwbGW9jeDeo/maxresdefault.jpg",
    link: "https://www.youtube.com/watch?v=qwbGW9jeDeo"
  },
  {
    title: "How To Get Rid Of Acne Scars 😲",
    author: "Dillon Latham",
    pubDate: "2024-01-11T00:00:00.000Z",
    thumbnail: "https://i.ytimg.com/vi/mS2x9kKh8xY/maxresdefault.jpg",
    link: "https://www.youtube.com/watch?v=mS2x9kKh8xY"
  },
  {
    title: "How to find your hair porosity 😲",
    author: "Dillon Latham",
    pubDate: "2024-02-15T00:00:00.000Z",
    thumbnail: "https://i.ytimg.com/vi/LnHeZ2XmMkU/maxresdefault.jpg",
    link: "https://www.youtube.com/watch?v=LnHeZ2XmMkU"
  }
];

export default function NewsPage() {
  const [feedItems, setFeedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [columnsCount, setColumnsCount] = useState(1);

  // Determine columns for masonry
  useEffect(() => {
    const updateColumns = () => {
      if (window.innerWidth >= 1280) setColumnsCount(4);
      else if (window.innerWidth >= 1024) setColumnsCount(3);
      else if (window.innerWidth >= 640) setColumnsCount(2);
      else setColumnsCount(1);
    };

    updateColumns(); // Initial check
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);

      // 1. Fetch Videos
      const videosData = FEATURED_VIDEOS.map(v => ({ ...v, type: 'video' }));

      // 2. Fetch News
      let newsData = [];
      try {
        const hardcodedArticles = [
          {
            id: "https://www.yahoo.com/entertainment/celebrity/articles/popular-looksmaxxing-influencer-androgenic-wig-201159441.html",
            title: "Popular looksmaxxing influencer Androgenic has wig snatched off his head in humiliating public stunt",
            source: "Yahoo Entertainment",
            pubDate: "2026-02-22T20:11:00.000Z",
            link: "https://www.yahoo.com/entertainment/celebrity/articles/popular-looksmaxxing-influencer-androgenic-wig-201159441.html",
            thumbnail: "https://s.yimg.com/os/creatr-uploaded-images/2026-02/a3c6e440-b9df-11ef-9eff-1c19b0b4b74e"
          },
          {
            id: "https://www.theguardian.com/us-news/2026/mar/27/clavicular-arrested-florida-battery-charges",
            title: "Social media influencer Clavicular arrested in Florida on battery charges",
            source: "The Guardian",
            pubDate: "2026-03-27T17:09:00.000Z",
            link: "https://www.theguardian.com/us-news/2026/mar/27/clavicular-arrested-florida-battery-charges",
            thumbnail: "https://i.guim.co.uk/img/media/0ec6d1fdbcc972ec0b4e3f412e2c0e7e1ef0e854/0_231_4923_2954/master/4923.jpg?width=1200&height=630&quality=85&auto=format&fit=crop&overlay-align=bottom%2Cleft&overlay-width=100p&overlay-base64=L2ltZy9zdGF0aWMvb3ZlcmxheXMvdGctZGVmYXVsdC5wbmc&enable=upscale&s=10b5435a21e4282362b53f6db9e5789f"
          },
          {
            id: "https://www.theguardian.com/society/commentisfree/2026/mar/24/clavicular-insecure-young-men-looksmaxxing",
            title: "Behind the rise of Clavicular and ‘looksmaxxing’ there are insecure young men who feel they don’t measure up",
            source: "The Guardian",
            pubDate: "2026-03-24T03:00:00.000Z",
            link: "https://www.theguardian.com/society/commentisfree/2026/mar/24/clavicular-insecure-young-men-looksmaxxing",
            thumbnail: "https://i.guim.co.uk/img/media/e142dfa547daed4e3b1c676d11f7c6e6b6bb7b7d/0_89_3500_2101/master/3500.jpg?width=1200&height=630&quality=85&auto=format&fit=crop&overlay-align=bottom%2Cleft&overlay-width=100p&overlay-base64=L2ltZy9zdGF0aWMvb3ZlcmxheXMvdGctb3BpbmlvbnMucG5n&enable=upscale&s=0f4b30d367468249de6593a20d4f2bc1"
          },
          {
            id: "https://www.bbc.com/culture/article/20240326-inside-looksmaxxing-the-extreme-cosmetic-social-media-trend",
            title: "Inside looksmaxxing, the extreme cosmetic social media trend",
            source: "BBC Culture",
            pubDate: "2024-03-26T00:00:00.000Z",
            link: "https://www.bbc.com/culture/article/20240326-inside-looksmaxxing-the-extreme-cosmetic-social-media-trend",
            thumbnail: "https://ychef.files.bbci.co.uk/1200x675/p0hltkh2.jpg"
          },
          {
            id: "https://www.nytimes.com/2025/10/11/magazine/on-language-maxxing.html",
            title: "The Linguistic 'Maxxing' Trend: How Optimization Culture Took Over Our Vocabulary",
            source: "The New York Times",
            pubDate: "2025-10-11T00:00:00.000Z",
            link: "https://www.nytimes.com/2025/10/11/magazine/on-language-maxxing.html",
            thumbnail: "https://static01.nyt.com/images/2025/10/11/magazine/11mag-onlanguage-1/11mag-onlanguage-1-facebookJumbo.jpg"
          }
        ];
        newsData = hardcodedArticles.map(n => ({ ...n, type: 'news' }));
      } catch (err) {
        console.error("News fetch failed:", err);
      }

      // 3. Fetch Reddit
      let redditData = [];
      try {
        const proxyUrl = 'https://corsproxy.io/?';
        const targetUrl = encodeURIComponent('https://www.reddit.com/r/LooksmaxingAdvice+trueratecelebrities/hot.json?limit=15');
        
        const res = await fetch(proxyUrl + targetUrl);
        const data = await res.json();
        
        const posts = data.data.children
          .map(child => child.data)
          .filter(post => 
            post.post_hint === 'image' || 
            (post.url && post.url.match(/\.(jpeg|jpg|gif|png)$/i)) ||
            (post.is_gallery && post.media_metadata)
          )
          .map(post => {
            let imgUrl = post.url;
            
            if (post.is_gallery && post.media_metadata) {
              const mediaKeys = Object.keys(post.media_metadata);
              if (mediaKeys.length > 0) {
                const firstMedia = post.media_metadata[mediaKeys[0]];
                if (firstMedia.s && firstMedia.s.u) {
                  imgUrl = firstMedia.s.u.replace(/&amp;/g, '&');
                }
              }
            } else if (post.preview && post.preview.images && post.preview.images.length > 0) {
              imgUrl = post.preview.images[0].source.url.replace(/&amp;/g, '&');
            } else if (post.post_hint !== 'image' && !post.url.match(/\.(jpeg|jpg|gif|png)$/i)) {
              imgUrl = post.thumbnail; 
            }

            return {
              id: post.id,
              type: 'reddit',
              title: post.title,
              author: `u/${post.author}`,
              subreddit: post.subreddit_name_prefixed,
              pubDate: new Date(post.created_utc * 1000).toISOString(),
              thumbnail: imgUrl,
              link: `https://reddit.com${post.permalink}`,
              upvotes: post.ups,
              comments: post.num_comments
            };
          });

        redditData = posts.slice(0, 8);
      } catch (err) {
        console.error("Reddit fetch failed:", err);
      }

      // Combine and sort
      const combined = [...videosData, ...newsData, ...redditData];
      combined.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      
      setFeedItems(combined);
      setLoading(false);
    };

    fetchAll();
  }, []);

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Splitting feedItems left-to-right into columns
  const columns = Array.from({ length: columnsCount }, () => []);
  feedItems.forEach((item, index) => {
    columns[index % columnsCount].push(item);
  });

  const renderFeedItem = (item, idx) => {
    if (item.type === 'video') {
      return (
        <a 
          key={item.id || item.link || idx} 
          href={item.link} 
          target="_blank" 
          rel="noopener noreferrer"
          className="group flex flex-col bg-[#0c0d0e] border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-zinc-600 transition-all duration-500 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] hover:-translate-y-1 w-full"
        >
          <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
            <img 
              src={item.thumbnail} 
              alt={item.title} 
              referrerPolicy="no-referrer"
              onError={(e) => { e.target.src = "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=600&h=400"; }}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
              <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center text-white shadow-[0_0_20px_rgba(220,38,38,0.5)] transform scale-90 group-hover:scale-100 transition-transform duration-300">
                <Play fill="currentColor" size={20} className="ml-1" />
              </div>
            </div>
            <div className="absolute top-3 left-3 bg-red-600/90 backdrop-blur-sm px-2 py-1 rounded flex items-center gap-1.5 shadow-lg">
              <Youtube size={12} className="text-white" />
              <span className="text-[10px] font-mono font-bold text-white uppercase">Video</span>
            </div>
            <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-md px-2 py-1 rounded text-[10px] font-mono font-bold text-white uppercase">
              {formatDate(item.pubDate)}
            </div>
          </div>
          <div className="p-5 flex flex-col flex-grow">
            <div className="text-red-400 font-sans text-[10px] uppercase font-bold tracking-widest mb-2 flex items-center justify-between">
              {item.author}
              <ExternalLink size={12} className="opacity-50" />
            </div>
            <h3 className="text-white font-bold text-lg leading-snug group-hover:text-red-50 transition-colors">
              {item.title}
            </h3>
          </div>
        </a>
      );
    }

    if (item.type === 'reddit') {
      return (
        <a 
          key={item.id || item.link || idx} 
          href={item.link} 
          target="_blank" 
          rel="noopener noreferrer"
          className="group flex flex-col bg-[#0c0d0e] border border-zinc-800/80 rounded-xl overflow-hidden hover:border-zinc-600 transition-all duration-300 hover:-translate-y-1 w-full"
        >
          {item.thumbnail && (
            <div className="relative w-full overflow-hidden bg-zinc-900">
              <img 
                src={item.thumbnail} 
                alt={item.title} 
                referrerPolicy="no-referrer"
                className="w-full h-auto object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute top-2 right-2 bg-orange-600/90 backdrop-blur-sm px-2 py-1 rounded flex items-center gap-1.5 shadow-lg">
                <MessageSquare size={10} className="text-white" />
                <span className="text-[9px] font-mono font-bold text-white uppercase">Reddit</span>
              </div>
              <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md px-2 py-1 rounded text-[9px] font-mono font-bold text-orange-400 uppercase">
                {item.subreddit}
              </div>
            </div>
          )}
          <div className="p-4 flex flex-col flex-grow justify-between gap-3">
            {!item.thumbnail && (
              <div className="flex items-center gap-2 mb-1">
                <div className="bg-orange-600/20 text-orange-500 px-2 py-1 rounded flex items-center gap-1.5 w-fit">
                  <MessageSquare size={10} />
                  <span className="text-[9px] font-mono font-bold uppercase">Reddit</span>
                </div>
                <div className="bg-zinc-800/50 text-zinc-400 px-2 py-1 rounded text-[9px] font-mono font-bold uppercase">
                  {item.subreddit}
                </div>
              </div>
            )}
            <h3 className="text-zinc-100 font-bold text-base leading-snug group-hover:text-orange-300 transition-colors">
              {item.title}
            </h3>
            <div className="flex items-center justify-between text-xs font-bold font-sans uppercase tracking-widest mt-1">
              <span className="text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded">
                <TrendingUp size={12} /> {item.upvotes}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-blue-400 flex items-center gap-1.5 bg-blue-500/10 px-2 py-1 rounded">
                  <MessageSquare size={12} /> {item.comments}
                </span>
                <span className="text-zinc-500 text-[10px] hidden sm:block">{formatDate(item.pubDate)}</span>
              </div>
            </div>
          </div>
        </a>
      );
    }

    if (item.type === 'news') {
      return (
        <a 
          key={item.id || item.link || idx} 
          href={item.link} 
          target="_blank" 
          rel="noopener noreferrer"
          className="group flex flex-col bg-[#0c0d0e] border border-zinc-800/80 rounded-xl overflow-hidden hover:border-zinc-600 transition-all duration-300 hover:-translate-y-1 w-full"
        >
          <div className="p-5 flex flex-col flex-grow gap-3">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase border border-blue-500/20 flex items-center gap-1.5 w-fit">
                <Newspaper size={12} />
                {item.source}
              </div>
            </div>
            <h3 className="text-zinc-100 font-bold text-lg leading-snug group-hover:text-blue-400 transition-colors">
              {item.title}
            </h3>
            <div className="mt-2 flex items-center justify-between text-xs font-bold font-sans uppercase tracking-widest text-zinc-500">
              <div className="flex items-center gap-1.5">
                <Clock size={12} />
                {formatDate(item.pubDate)}
              </div>
              <ExternalLink size={12} className="opacity-50" />
            </div>
          </div>
        </a>
      );
    }

    return null;
  };

  return (
    <div className="w-full flex flex-col items-center pt-32 pb-24 px-6 min-h-screen bg-[#0a0a0b] relative">
      
      {/* Background glow */}
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-red-500/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-7xl mx-auto flex flex-col gap-12 relative z-10">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-zinc-800 pb-8">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="bg-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-sm flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> Live Feed
              </span>
              <span className="text-zinc-500 font-mono text-xs uppercase tracking-widest flex items-center gap-1">
                <TrendingUp size={14} /> LIVE UPDATE
              </span>
            </div>
            <h1 className="text-6xl md:text-[5.5rem] font-black uppercase tracking-tighter italic text-transparent bg-clip-text bg-gradient-to-br from-white to-zinc-500" style={{ letterSpacing: '-0.05em', textShadow: '0 0 1px rgba(255,255,255,0.3)' }}>
              NEWS
            </h1>
            <p className="text-zinc-400 font-sans uppercase tracking-[0.2em] text-sm mt-4 max-w-2xl">
              Automated intelligence gathering. Latest analysis, strategies, and community ratings from top analysts.
            </p>
          </div>
        </div>

        {/* Masonry Feed (Custom Column Splitting) */}
        {loading ? (
          <div className="w-full h-64 flex flex-col items-center justify-center gap-4 text-zinc-500 mt-12">
            <Loader2 className="animate-spin text-red-500" size={32} />
            <span className="font-mono uppercase tracking-widest text-xs">LOADING MEDIA...</span>
          </div>
        ) : feedItems.length > 0 ? (
          <div className="flex w-full gap-6 items-start">
            {columns.map((col, colIdx) => (
              <div key={colIdx} className="flex flex-col gap-6 flex-1 min-w-0">
                {col.map((item, idx) => renderFeedItem(item, idx))}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-zinc-500 font-mono text-sm uppercase tracking-widest text-center mt-12">No feed items found.</div>
        )}

      </div>
    </div>
  );
}
