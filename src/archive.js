let database
function db() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('evolution-simulator', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('runs', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}

async function execute(mode, action) {
  const connection = await db()
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('runs', mode)
    const request = action(tx.objectStore('runs'))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = tx.onerror = () => reject(tx.error ?? request.error)
  })
}

export const listRuns = () => execute('readonly', store => store.getAll())
export const saveRun = run => execute('readwrite', store => store.put(run))
export const saveRunPair = (left, right) => execute('readwrite', store => {
  store.put(left)
  return store.put(right)
})
export const deleteRun = id => execute('readwrite', store => store.delete(id))
