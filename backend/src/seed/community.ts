/**
 * Demo community content: posts on every board in several languages, with comments, replies, likes and a few
 * generated photos (simple illustrations encoded as PNG with node:zlib, written to uploads/community).
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { Types } from 'mongoose';
import { Comment } from '../models/Comment';
import { Post } from '../models/Post';
import { COMMUNITY_DIR, deletePhotos } from '../services/upload.service';

type Rgb = [number, number, number];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal PNG encoder (8-bit RGB, no interlace). */
function png(width: number, height: number, pixel: (x: number, y: number) => Rgb): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
const W = 640;
const H = 400;

/** Small bus drawn at (bx, by): body, windows and wheels. */
function bus(x: number, y: number, bx: number, by: number, color: Rgb): Rgb | null {
  const inBody = x >= bx && x < bx + 150 && y >= by && y < by + 56;
  const window = x >= bx + 10 && x < bx + 140 && y >= by + 8 && y < by + 26 && (x - bx - 10) % 22 < 17;
  const wheel = [bx + 30, bx + 120].some((cx) => (x - cx) ** 2 + (y - (by + 58)) ** 2 < 100);
  if (wheel) return [30, 30, 30];
  if (window) return [190, 225, 245];
  return inBody ? color : null;
}

const SCENES: Record<string, (x: number, y: number) => Rgb> = {
  // Sunrise over an expressway
  sunrise: (x, y) => {
    const b = bus(x, y, 380, 270, [204, 68, 76]);
    if (b) return b;
    if (y < 250) {
      const sun = (x - 200) ** 2 + (y - 210) ** 2 < 55 ** 2;
      return sun ? [255, 214, 120] : mix([70, 60, 140], [250, 160, 90], y / 250);
    }
    const road = Math.abs(x - W / 2) < (y - 230) * 2.2;
    if (road) return (Math.abs(x - W / 2) < 3 && Math.floor(y / 14) % 2 === 0) ? [245, 235, 200] : [70, 72, 80];
    return mix([96, 140, 80], [60, 100, 55], (y - 250) / 150);
  },
  // Green hills in the monsoon
  hills: (x, y) => {
    const hill1 = y > 210 + 40 * Math.sin(x / 90);
    const hill2 = y > 250 + 30 * Math.sin(x / 60 + 1.5);
    const cloud = [[150, 80], [420, 60], [540, 110]].some(([cx, cy]) => (x - cx) ** 2 / 3 + (y - cy) ** 2 < 600);
    if (hill2) return mix([70, 140, 70], [40, 100, 50], (y - 250) / 150);
    if (hill1) return mix([110, 170, 100], [80, 140, 80], (y - 200) / 200);
    if (cloud) return [235, 238, 242];
    return mix([140, 170, 200], [200, 215, 230], y / 220);
  },
  // City lights at night
  night: (x, y) => {
    const b = bus(x, y, 120, 300, [240, 180, 60]);
    if (b) return b;
    const building = (Math.floor(x / 48) * 37) % 140 + 120;
    if (y > 360) return [40, 40, 50];
    if (y > H - building - 40) {
      const lit = x % 16 < 7 && y % 22 < 10 && ((x * 7 + y * 3) % 5 === 0);
      return lit ? [250, 220, 130] : [35, 40, 70];
    }
    const star = (x * 13 + y * 7) % 211 === 0;
    return star ? [255, 255, 255] : mix([10, 15, 45], [40, 45, 95], y / 300);
  },
  // Fort walls under a clear sky
  fort: (x, y) => {
    const wall = y > 230 && !(y < 260 && Math.floor(x / 30) % 2 === 0);
    const tower = Math.abs(x - 470) < 40 && y > 150;
    const dome = (x - 470) ** 2 + (y - 150) ** 2 < 40 ** 2 && y <= 150;
    if (dome) return [222, 160, 110];
    if (tower || wall) return mix([214, 150, 100], [180, 110, 75], (y - 150) / 250);
    if (y > 340) return [200, 170, 120];
    return mix([110, 170, 230], [190, 220, 245], y / 230);
  },
};

async function writeScene(name: keyof typeof SCENES) {
  await fs.mkdir(COMMUNITY_DIR, { recursive: true });
  const data = png(W, H, SCENES[name]);
  const file = `${crypto.randomBytes(16).toString('hex')}.png`;
  await fs.writeFile(path.join(COMMUNITY_DIR, file), data);
  return { file, type: 'png' as const, size: data.length };
}

type UserRef = { _id: Types.ObjectId };
type RouteRef = { _id: Types.ObjectId; from: string; to: string };

interface SeedPost {
  by: number;
  board: 'stories' | 'tips' | 'routes' | 'destinations' | 'advice';
  lang: 'en' | 'hi' | 'mr' | 'bn' | 'te';
  title: string;
  body: string;
  route?: [string, string];
  city?: string;
  photos?: { scene: keyof typeof SCENES; alt: string }[];
  daysAgo: number;
  likes: number;
  comments?: { by: number; body: string; replies?: { by: number; body: string }[] }[];
}

// by = index in the demo reviewers list (seed.ts REVIEWERS)
const POSTS: SeedPost[] = [
  {
    by: 0, board: 'stories', lang: 'en', title: 'Sunrise ride on the Mumbai–Pune Expressway', route: ['Mumbai', 'Pune'], daysAgo: 1, likes: 6,
    body: 'Took the 5:30 AM bus from Dadar and watched the sun come up over the ghats.\n\nThe bus stopped for ten minutes at the food mall near Lonavala, and we reached Swargate right on time. Window seat on the left side is the one you want for the valley views.',
    photos: [{ scene: 'sunrise', alt: 'Sunrise over the expressway with a red bus on the road' }],
    comments: [
      { by: 1, body: 'Left window seat tip is spot on. Did the same trip last month!', replies: [{ by: 0, body: 'Glad it worked for you too!' }] },
      { by: 4, body: 'Beautiful photo. Was the AC too cold that early?' },
    ],
  },
  {
    by: 1, board: 'stories', lang: 'hi', title: 'रात की बस से बेंगलुरु से चेन्नई', route: ['Bengaluru', 'Chennai'], daysAgo: 3, likes: 4,
    body: 'पहली बार स्लीपर बस में सफ़र किया। बर्थ साफ़ थी और कंबल भी मिला।\n\nसुबह छह बजे चेन्नई पहुँचे, नींद भी पूरी हुई। अगली बार भी रात की बस ही लूँगा।',
    comments: [{ by: 2, body: 'स्लीपर में नीचे वाली बर्थ ज़्यादा आरामदायक लगती है।' }],
  },
  {
    by: 6, board: 'tips', lang: 'en', title: 'Five things I always pack for an overnight bus', daysAgo: 2, likes: 8,
    body: '1. A light shawl, because the AC can get cold.\n2. A neck pillow.\n3. A power bank and a short cable.\n4. Snacks and a water bottle.\n5. Earplugs and an eye mask.\n\nKeep your ticket on your phone and arrive fifteen minutes early at the boarding point.',
    comments: [
      { by: 3, body: 'I would add a small torch for night stops.', replies: [{ by: 6, body: 'Great idea, adding that to my list.' }] },
      { by: 5, body: 'Earplugs are a lifesaver on long routes.' },
    ],
  },
  {
    by: 2, board: 'tips', lang: 'mr', title: 'बसने प्रवास करताना सामान कसे ठेवावे', daysAgo: 6, likes: 3,
    body: 'मोठी बॅग डिक्कीत ठेवा आणि महत्त्वाच्या वस्तू जवळच्या छोट्या बॅगेत ठेवा.\n\nपाणी, औषधे आणि चार्जर नेहमी हाताशी असू द्या. उतरताना सीटखाली काही राहिले नाही ना हे नक्की पाहा.',
  },
  {
    by: 5, board: 'routes', lang: 'en', title: 'Delhi to Jaipur: which departure is best?', route: ['Delhi', 'Jaipur'], daysAgo: 4, likes: 2,
    body: 'I have tried the early morning and the afternoon buses on this route. The morning one avoids city traffic and reaches Jaipur before lunch.\n\nWhich departure do you prefer, and why?',
    comments: [
      { by: 0, body: 'Morning for sure. The afternoon bus got stuck near Gurugram for almost an hour.' },
      { by: 3, body: 'The overnight one is good if you want a full day in Jaipur.' },
    ],
  },
  {
    by: 4, board: 'routes', lang: 'te', title: 'హైదరాబాద్ నుండి బెంగళూరు – రాత్రి బస్సు అనుభవం', route: ['Hyderabad', 'Bengaluru'], daysAgo: 5, likes: 5,
    body: 'రాత్రి పది గంటలకు బయలుదేరి ఉదయం ఆరు గంటలకు చేరుకున్నాం.\n\nమధ్యలో ఒకసారి భోజనానికి ఆగారు. సీట్లు సౌకర్యంగా ఉన్నాయి, ప్రయాణం ప్రశాంతంగా సాగింది.',
    photos: [{ scene: 'night', alt: 'City lights at night with a yellow bus' }],
    comments: [{ by: 1, body: 'రాత్రి బస్సులో నిద్ర బాగా పడుతుంది!' }],
  },
  {
    by: 3, board: 'destinations', lang: 'bn', title: 'জয়পুরে দুই দিন: কী দেখবেন', city: 'Jaipur', daysAgo: 7, likes: 7,
    body: 'প্রথম দিন আমের দুর্গ আর জলমহল দেখুন। দ্বিতীয় দিন সিটি প্যালেস আর হাওয়া মহল।\n\nবিকেলে বাজারে ঘুরতে ভুলবেন না, হাতের কাজের জিনিস খুব সুন্দর।',
    photos: [{ scene: 'fort', alt: 'Fort walls and a domed tower under a blue sky' }],
    comments: [{ by: 0, body: 'Amer Fort at sunrise is magical. Thanks for the plan!' }],
  },
  {
    by: 0, board: 'destinations', lang: 'en', title: 'Pune in the monsoon', city: 'Pune', daysAgo: 9, likes: 5,
    body: 'If you visit Pune between July and September, take a day trip to the hills around Sinhagad. Everything turns green.\n\nCarry a rain jacket and good shoes; the paths get slippery.',
    photos: [
      { scene: 'hills', alt: 'Green hills and clouds during the monsoon' },
      { scene: 'sunrise', alt: 'Sunrise over the road near Pune' },
    ],
  },
  {
    by: 6, board: 'advice', lang: 'en', title: 'Is a sleeper bus safe for a solo woman traveller?', daysAgo: 2, likes: 3,
    body: 'I am planning my first overnight trip alone from Bengaluru to Chennai. Any advice on choosing a seat and an operator?',
    comments: [
      { by: 3, body: 'Book one of the seats reserved for women; they are marked on the seat map.', replies: [{ by: 6, body: 'Did not know that, thank you!' }] },
      { by: 1, body: 'Share your PNR with family and choose a lower berth near the front.' },
    ],
  },
  {
    by: 1, board: 'advice', lang: 'hi', title: 'बस छूट जाए तो क्या करें?', daysAgo: 8, likes: 1,
    body: 'अगर ट्रैफ़िक की वजह से बस छूट जाए तो क्या टिकट का पैसा वापस मिलता है? किसी के साथ ऐसा हुआ है?',
    comments: [{ by: 5, body: 'Departure ke baad cancel nahi hota, isliye pehle hi cancel karna better hai.' }],
  },
  {
    by: 4, board: 'stories', lang: 'te', title: 'చెన్నై నుండి బెంగళూరు – కుటుంబంతో ప్రయాణం', city: 'Chennai', daysAgo: 10, likes: 2,
    body: 'పిల్లలతో కలిసి మొదటిసారి బస్సులో ప్రయాణించాం. సిబ్బంది చాలా సహాయం చేశారు.\n\nపిల్లల కోసం చిన్న ఆటలు, తినుబండారాలు తీసుకెళ్ళడం మంచిది.',
  },
  {
    by: 3, board: 'tips', lang: 'bn', title: 'শীতে রাতের বাসযাত্রার টিপস', daysAgo: 11, likes: 2,
    body: 'শীতের রাতে বাসে একটা হালকা কম্বল বা শাল সঙ্গে রাখুন।\n\nগরম পানীয়ের জন্য একটা ছোট ফ্লাস্ক নিলে খুব কাজে লাগে।',
  },
  {
    by: 2, board: 'advice', lang: 'mr', title: 'महिलांसाठी राखीव सीट कशी निवडावी?', daysAgo: 12, likes: 4,
    body: 'सीट निवडताना गुलाबी रंगाने दाखवलेल्या सीट महिलांसाठी राखीव असतात. त्या फक्त महिला प्रवाशांना मिळतात.\n\nएकट्याने प्रवास करताना या सीट निवडणे सुरक्षित वाटते.',
  },
];

/** Replaces all community posts and comments (and their photo files) with the demo content. */
export async function seedCommunity(users: UserRef[], extraLikers: UserRef[], routes: RouteRef[]): Promise<{ posts: number; comments: number; photos: number }> {
  const old = await Post.find().select('photos').lean();
  await deletePhotos(old.flatMap((p) => p.photos.map((ph) => ph.file)));
  await Promise.all([Comment.deleteMany({}), Post.deleteMany({})]);

  const likers = [...users, ...extraLikers];
  let comments = 0;
  let photos = 0;
  for (const p of POSTS) {
    const route = p.route ? routes.find((r) => r.from === p.route![0] && r.to === p.route![1]) : undefined;
    const createdAt = new Date(Date.now() - p.daysAgo * DAY_MS);
    const files = [];
    for (const ph of p.photos ?? []) files.push({ ...(await writeScene(ph.scene)), alt: ph.alt });
    photos += files.length;
    const likedBy = likers.filter((_, i) => i !== p.by).slice(0, p.likes).map((u) => u._id);
    const post = await Post.create({
      author: users[p.by]._id,
      board: p.board,
      title: p.title,
      body: p.body,
      language: p.lang,
      route: route?._id,
      city: p.city,
      photos: files,
      likedBy,
      likeCount: likedBy.length,
      createdAt,
    });
    let minute = 30;
    for (const c of p.comments ?? []) {
      const top = await Comment.create({ post: post._id, author: users[c.by]._id, body: c.body, createdAt: new Date(createdAt.getTime() + minute++ * 60_000) });
      comments++;
      for (const r of c.replies ?? []) {
        await Comment.create({ post: post._id, author: users[r.by]._id, parent: top._id, body: r.body, createdAt: new Date(createdAt.getTime() + minute++ * 60_000) });
        comments++;
      }
    }
    await Post.updateOne({ _id: post._id }, { $set: { commentCount: await Comment.countDocuments({ post: post._id }) } });
  }
  return { posts: POSTS.length, comments, photos };
}
