/**
 * image-utils.js
 * Shrink a photo in the browser so it can be stored inside a Firestore
 * document (1 MB limit) without needing Firebase Storage.
 */

/**
 * Resize an image File to fit within maxSize × maxSize and return a JPEG data URL.
 * Quality is lowered step by step until the result is under maxBytes.
 */
export async function compressImage(file, { maxSize = 1280, maxBytes = 650_000 } = {}) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Please choose an image file.");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("This image could not be read."));
      i.src = url;
    });

    let size = maxSize;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= maxBytes) return dataUrl;
      }
      size = Math.round(size * 0.75);
    }
    throw new Error("This image is too large even after compression.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
