function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('streamroom.profileMedia', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('media');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error('Não foi possível abrir os banners salvos.'));
  });
}

export async function bannerStorage(value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('media', value === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('media');
      const request = value === undefined ? store.get('banner') : store.put(value, 'banner');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(Error('Não foi possível salvar o banner neste PC.'));
      transaction.onabort = () => reject(Error('O salvamento do banner foi interrompido.'));
    });
  } finally { db.close(); }
}
