/** Resize an image to a compact square before saving it to plugin settings. */
export function readAvatarImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    return Promise.reject(new Error("Choose a PNG, JPG, GIF, or WebP image."));
  }
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error("Avatar must be smaller than 5 MB."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not decode the image."));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 192;
        canvas.height = 192;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Image canvas unavailable.")); return; }
        const scale = Math.max(192 / image.naturalWidth, 192 / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        ctx.drawImage(image, (192 - width) / 2, (192 - height) / 2, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      if (typeof reader.result !== "string") { reject(new Error("Could not read image data.")); return; }
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
