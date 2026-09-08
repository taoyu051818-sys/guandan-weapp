/** A timer remains cancellable after firing, until its serialized room job completes. */
export const createRoomExpiryJobs = ({ rooms, enqueueServerOperation, setTimeout, clearTimeout }) => {
  const jobs = new Map()
  let disposed = false
  const cancel = (kind, roomId) => {
    const key = `${kind}:${roomId}`
    const job = jobs.get(key)
    if (job) clearTimeout(job.timer)
    jobs.delete(key)
  }
  const schedule = (kind, room, delay, operation) => {
    cancel(kind, room.roomId)
    if (disposed || rooms.get(room.roomId) !== room) return
    const key = `${kind}:${room.roomId}`
    const job = { timer: null }
    const current = () => !disposed && jobs.get(key) === job && rooms.get(room.roomId) === room
    jobs.set(key, job)
    job.timer = setTimeout(() => {
      void enqueueServerOperation(async () => {
        try { if (current()) await operation(current) }
        finally { if (jobs.get(key) === job) jobs.delete(key) }
      }, `${kind} expiry ${room.roomId}`, room.roomId)
    }, Math.max(0, delay))
  }
  const dispose = () => {
    disposed = true
    for (const job of jobs.values()) clearTimeout(job.timer)
    jobs.clear()
  }
  return { schedule, cancel, dispose }
}
