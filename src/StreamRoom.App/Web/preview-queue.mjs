// Keep native preview work bounded even when the user changes tabs/search rapidly.
export function createPreviewQueue(load, concurrency = 2) {
  let generation = 0, running = 0, pending = [];
  function pump() {
    while (running < concurrency && pending.length) {
      const task = pending.shift(); running++;
      Promise.resolve().then(() => load(task.source)).catch(() => null).then(result => {
        if (task.generation === generation) task.done(result);
      }).finally(() => { running--; pump(); });
    }
  }
  return {
    add(source, done) { pending.push({ source, done, generation }); pump(); },
    reset() { generation++; pending = []; }
  };
}
