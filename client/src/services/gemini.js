import { GoogleGenerativeAI } from '@google/generative-ai';

// Rejects if `promise` does not settle within `ms`. Unlike relying on the
// request's AbortSignal, this guarantees the caller is unblocked even when the
// underlying fetch ignores abort (as can happen in the Capacitor WebView).
function withTimeoutReject(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Converts a File object to a base64 string, stripping the data URI prefix.
 * @param {File} file 
 * @returns {Promise<{base64Data: string, mimeType: string}>}
 */
export const fileToGenerativePart = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result;
      // Strip metadata prefix (e.g., "data:image/jpeg;base64,")
      const base64Data = base64String.split(',')[1];
      resolve({
        base64Data,
        mimeType: file.type
      });
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

/**
 * Queries Gemini Flash to analyze an item image and extract structured metadata.
 * @param {string} apiKey - The user's Gemini API key
 * @param {File} imageFile - The compressed image file
 * @returns {Promise<{title: string, description: string, tags: string[], colors: string[], visible_text: string}>}
 */
export async function analyzeItemImage(apiKey, imageFile, signal) {
  if (!apiKey) {
    throw new Error("Gemini API key is required. Please set it in Settings.");
  }

  const { base64Data, mimeType } = await fileToGenerativePart(imageFile);

  const genAI = new GoogleGenerativeAI(apiKey);
  // Using gemini-3.1-flash-lite
  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite",
    generationConfig: {
      responseMimeType: "application/json"
    }
  });

  const prompt = `Identify and analyze the specific storage/inventory item being presented in this image. 
  
  CRITICAL INSTRUCTION: Ignore the background environment, any holding hands/fingers, or any person presenting the object. Focus your analysis entirely on the physical item itself.
  
  Return a JSON object strictly formatted as:
  {
    "title": "2-4 words summarizing the item",
    "description": "1 sentence describing the item, its state, and notable features",
    "tags": ["tag1", "tag2"],
    "colors": ["color1"],
    "visible_text": "any brands, serial numbers, labels, or text visible on the item"
  }`;

  const imagePart = {
    inlineData: {
      data: base64Data,
      mimeType
    }
  };

  // Bound the network call so a stalled request can never hang the caller
  // forever. Race against a hard timeout that rejects regardless of whether the
  // underlying fetch honors abort (it may not in the Capacitor WebView). This
  // also prevents the multi-add queue from deadlocking once every concurrency
  // slot is occupied by a stuck request. The AbortController is still passed
  // for best-effort cancellation when the caller bails.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const result = await withTimeoutReject(
      model.generateContent([prompt, imagePart], { signal: controller.signal }),
      20000,
      'Gemini request timed out'
    );
    const response = await result.response;
    const text = response.text();

    try {
      return JSON.parse(text);
    } catch (err) {
      console.error("Failed to parse Gemini response text as JSON:", text, err);
      throw new Error("Gemini returned invalid JSON. Please try capturing the image again.");
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
