/**
 * blog-data.js
 * ─────────────────────────────────────────────────────────────
 * Built-in articles. The website shows them until the admin panel
 * takes over the blog; the admin panel then copies them into
 * Firestore so they can be edited. Content is Markdown.
 *
 * rev: bump when an article's text changes. The admin panel then
 * offers to update the copies already in Firestore.
 * replaces: old slug of the same article (its address changed).
 * ─────────────────────────────────────────────────────────────
 */

export const STARTER_POSTS = [
  {
    slug: "how-firo-detects-wildfires-at-the-edge",
    rev: 3,
    title: "How FIRO detects wildfires at the edge",
    excerpt: "A camera, a small computer and AI that answers in under a second: this is how FIRO spots fire without sending a single image to the cloud.",
    tags: ["Technology", "Edge AI"],
    author: "FIRO Team",
    cover: "/assets/blog/firo-at-the-edge.jpg",
    published: true,
    published_at: Date.UTC(2026, 0, 12),
    content: `Most wildfire monitoring still depends on satellites, watchtowers and phone calls from the public. Each of these is slow in its own way: satellites pass over on fixed schedules and struggle with cloud cover, towers need people watching around the clock, and phone calls only come once a fire is already visible from a village.

FIRO takes a different approach: **put the intelligence next to the camera.**

## How it works

1. **Capture.** A tower-mounted camera photographs the forest at regular intervals.
2. **Check.** A small, low-power computer next to the camera prepares each picture for the AI.
3. **Decide.** AI models with **97.5% accuracy** decide *fire* or *no fire* and give a confidence score, all on the device.
4. **Report.** Only a tiny message (result, confidence, camera location and time) is sent to the cloud.
5. **Alert.** The monitoring dashboard updates in real time, and Forest Department staff can forward the alert on WhatsApp with one tap.

## Why on the device?

Forest areas in Azad Jammu & Kashmir often have weak or unstable connectivity. Uploading full images would be slow, expensive and fragile. Running the AI locally means:

- **Speed.** A decision in under a second.
- **Low bandwidth.** A short message instead of pictures.
- **Resilience.** Detection keeps working even when the network does not.

> FIRO sends *what it saw*, not *the picture*, which keeps it fast, affordable and private.

## What comes next

Detection is only useful if someone acts on it. That is why FIRO pairs the device in the forest with a live dashboard, a public event log and an online **Report a Fire** form, so that sensors and people work together.`,
  },
  {
    slug: "wildfire-season-in-pakistan-and-ajk",
    rev: 2,
    title: "Wildfire season in Pakistan and AJK: what the data says",
    excerpt: "Thousands of high-confidence fire alerts, forests burning from Sherani to Margalla Hills to Neelum Valley. A look at why early warning matters.",
    tags: ["Wildfires", "Research"],
    author: "FIRO Team",
    cover: "/assets/blog/wildfire-season.jpg",
    published: true,
    published_at: Date.UTC(2026, 0, 26),
    content: `Forest fires in Pakistan are becoming more frequent and more destructive, especially in the northern forests and in Azad Jammu & Kashmir.

## The numbers

- Between **29 April 2024 and 28 April 2025**, Global Forest Watch recorded **2,214 high-confidence VIIRS fire alerts** across Pakistan.
- **2024** had the highest count of yearly alerts on record, with **1,905**.
- The peak fire season typically begins in mid-December and lasts roughly **25 weeks**.

## Recent incidents

| Year | Location | Area | Key impacts |
|---|---|---|---|
| 2020 | Sherani Forest | 8,000+ ha | 30% of olive trees destroyed, long-term soil damage |
| 2022 | Margalla Hills | 500+ ha | Biodiversity loss, air-quality crisis |
| 2024 | Gilgit-Baltistan | 600+ ha | Threat to glacial ecosystems, water contamination |
| 2025 | Neelum Valley, AJK | — | Large December forest fire |

## Why current monitoring falls short

- **Satellites** cover huge areas but suffer from revisit delays, cloud interference and coarse resolution, so small fires are often missed until they grow.
- **Watchtowers** depend on people and are hard to staff in mountainous terrain.
- **Public reports** arrive late, usually when smoke is already visible from settlements.

## Where FIRO fits

FIRO is designed for exactly this gap: an **affordable, on-site** sensor that watches continuously and raises an alert within seconds. Combined with public reporting through this website, it gives forest teams more eyes on the ground at a fraction of the cost of traditional systems.`,
  },
  {
    slug: "choosing-the-right-ai-for-the-forest",
    replaces: "why-we-chose-mobilenetv2",
    rev: 3,
    title: "Choosing the right AI for the forest",
    excerpt: "The most accurate AI is not always the best one. Why FIRO chose models that are fast enough to run in real time on a low-cost device.",
    tags: ["Machine Learning", "Technology"],
    author: "FIRO Team",
    cover: "/assets/blog/choosing-the-right-ai.jpg",
    published: true,
    published_at: Date.UTC(2026, 1, 9),
    content: `Choosing the AI for FIRO was not about finding the most accurate model on paper. It was about finding the most accurate model **that can run in real time on a small, low-cost device in the forest**.

## Accuracy and speed

We trained and compared several AI models on thousands of pictures of forests with and without fire. Some of the largest models were slightly more accurate, but they were too slow and too power-hungry for a device that has to watch the forest day and night.

The models FIRO uses reach **97.5% accuracy** while being small enough to:

- answer in **under a second** on low-power hardware,
- run **continuously**, without a data centre or a fast internet connection, and
- keep working **offline**, sending alerts as soon as the connection returns.

## Built for real conditions

Forests are not a lab. Light changes through the day, smoke and fog look alike, and nights are dark. FIRO's AI was trained to handle this variety and tuned to keep false alarms low, so that every alert is worth checking.

## Tested in the real world

Between December 2025 and January 2026 we tested FIRO on real night-time forest fires near Khuiratta and Nakyal, AJK. **Every fire was detected correctly**, despite low light, artificial lighting and smoke.

> In the field, a model that runs every second is worth more than a slightly better one that cannot run at all.`,
  },
];
