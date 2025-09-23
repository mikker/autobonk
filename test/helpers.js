export async function waitForAtLeast(count, cb) {
  let attempts = 0
  let list

  do {
    if (attempts++ > 50) throw new Error('Waited too long')
    await new Promise((resolve) => setTimeout(resolve, 100))
    list = await cb()
  } while (list.length === 0)

  return list
}
