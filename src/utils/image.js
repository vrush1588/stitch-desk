const MAX_IMAGE_DIMENSION = 800;

export async function resizeImageToDataUrl(
  file,
  maxDimension = MAX_IMAGE_DIMENSION,
  quality = 0.82,
) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file to attach.");
  }
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error("Image size limit must be a positive number.");
  }
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new Error("Image quality must be between 0 and 1.");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("This browser cannot resize the selected image.");
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch (error) {
    throw new Error(`Unable to prepare this photo: ${error.message}`);
  } finally {
    bitmap?.close();
  }
}
