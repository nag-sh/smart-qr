// Transient holder for a captured image being handed from Add Item to the
// item-details view. Modal params are URL-serialized and cannot carry a File,
// so the image lives here in memory for the duration of the navigation.
let pendingFile = null;

export function setPendingCreate(file) {
  pendingFile = file;
}

export function takePendingCreate() {
  const file = pendingFile;
  pendingFile = null;
  return file;
}
