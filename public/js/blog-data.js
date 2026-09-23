/**
 * blog-data.js
 * ─────────────────────────────────────────────────────────────
 * Starter articles. They are shown on the blog until posts exist
 * in Firestore, and the admin panel can import them into Firestore
 * ("Import starter posts") so they become editable.
 * Content is Markdown.
 * ─────────────────────────────────────────────────────────────
 */

export const STARTER_POSTS = [
  {
    slug: "how-firo-detects-wildfires-at-the-edge",
    title: "How FIRO detects wildfires at the edge",
    excerpt: "A camera, a Raspberry Pi 5 and a 2.6-million-parameter neural network: this is how FIRO spots fire in under a second without sending a single image to the cloud.",
    tags: ["Technology", "Edge AI"],
    author: "FIRO Team",
    cover: "",
    published: true,
    published_at: Date.UTC(2026, 0, 12),
    content: `Most wildfire monitoring still depends on satellites, watchtowers and phone calls from the public. Each of these is slow in its own way: satellites pass over on fixed schedules and struggle with cloud cover, towers need people watching around the clock, and phone calls only come once a fire is already visible from a village.

FIRO takes a different approach: **put the intelligence next to the camera.**

## The pipeline

1. **Capture.** A tower-mounted RGB camera photographs the forest at fixed intervals.
2. **Prepare.** The Raspberry Pi 5 resizes each frame to 224 × 224 pixels and normalises it.
3. **Classify.** An INT8-quantised MobileNetV2 model, running with TensorFlow Lite, decides *fire* or *no fire* and produces a confidence score, all on the device.
4. **Report.** Only a few hundred bytes of metadata (label, confidence, camera location, timestamp and device ID) are sent to Firebase.
5. **Alert.** The monitoring dashboard updates in real time, and Forest Department staff can forward the alert on WhatsApp with one tap.

## Why on the device?

Forest areas in Azad Jammu & Kashmir often have weak or unstable connectivity. Uploading full images would be slow, expensive and fragile. Running the model locally means:

- **Low latency.** Inference takes less than a second on the Pi.
- **Low bandwidth.** Metadata instead of images.
- **Resilience.** Detection keeps working even when the network does not.

> FIRO sends *what it saw*, not *the picture*, which keeps it fast, cheap and private.

## What comes next

Detection is only useful if someone acts on it. That is why FIRO pairs the edge device with a live dashboard, a public event log and an online **Report a Fire** form, so that sensors and people work together.`,
  },
  {
    slug: "wildfire-season-in-pakistan-and-ajk",
    title: "Wildfire season in Pakistan and AJK: what the data says",
    excerpt: "Thousands of high-confidence fire alerts, forests burning from Sherani to Margalla Hills to Neelum Valley. A look at why early warning matters.",
    tags: ["Wildfires", "Research"],
    author: "FIRO Team",
    cover: "",
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
    slug: "why-we-chose-mobilenetv2",
    title: "Why we chose MobileNetV2 for a Raspberry Pi",
    excerpt: "EfficientNet-B0 scored higher, so why didn't we use it? The trade-off between accuracy and running in real time on an $80 device.",
    tags: ["Machine Learning", "Research"],
    author: "FIRO Team",
    cover: "",
    published: true,
    published_at: Date.UTC(2026, 1, 9),
    content: `Choosing a model for FIRO was not about finding the most accurate network. It was about finding the most accurate network **that can run in real time on a Raspberry Pi 5**.

## The candidates

We trained several well-known architectures on the same wildfire dataset (6,247 images: 2,821 fire and 3,427 no-fire):

| Model | Parameters | Test accuracy |
|---|---|---|
| **MobileNetV2** | **2.6 M** | **97.50%** |
| VGG-16 | 15.24 M | 93.23% |
| ResNet-50 | ~25 M | 96.59% |
| EfficientNet-B0 | 4.38 M | 98.47% |
| EfficientNetV2-B0 | 6.25 M | 97.58% |
| YOLOv11 Nano | 1.53 M | 96.40% |

## Accuracy vs. efficiency

EfficientNet-B0 is about one point more accurate, but MobileNetV2:

- has **fewer parameters** (2.6 M),
- has **excellent TensorFlow Lite support**, and
- **quantises cleanly to INT8**, which is what makes sub-second inference possible on the Pi.

After INT8 quantisation the deployed model keeps about **95%** accuracy, precision, recall and F1-score, a small price for a model that runs continuously on low-power hardware.

## Training setup

- Transfer learning from ImageNet weights, then selective fine-tuning
- Adam optimiser (0.01 for feature extraction, 1 × 10⁻⁵ for fine-tuning)
- Batch size 32, input 224 × 224 × 3
- Trained on an NVIDIA Tesla P100 GPU

## Tested in the real world

We also tested the model on **12 night-time photos of real forest fires** near Khuiratta and Nakyal, AJK (December 2025 to January 2026). It classified **all 12 correctly**, despite low light, artificial lighting and smoke.

> In the field, a model that runs every second is worth more than a slightly better one that cannot run at all.`,
  },
];
