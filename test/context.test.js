import test from 'brittle'
import Corestore from 'corestore'
import * as dispatch from '../example/spec/dispatch/index.js'
import db from '../example/spec/db/index.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'
import { Room } from '../example/room.js'
import { waitForAtLeast } from './helpers.js'

const schema = { db, dispatch }

test('two autobonks communicate bidirectionally', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir1 = join(baseDir, `room1-${testId}`)
  const storageDir2 = join(baseDir, `room2-${testId}`)

  let room1, room2
  let store1, store2
  let pairer

  t.teardown(async () => {
    if (room1 && !room1.closed) await room1.close()
    if (room2 && !room2.closed) await room2.close()
    if (pairer && !pairer.closed) await pairer.close()
    if (store1) await store1.close()
    if (store2) await store2.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  store1 = new Corestore(storageDir1)
  room1 = new Room(store1, { schema })
  await room1.ready()

  const invite = await room1.createInvite()
  t.ok(invite, 'invite created')

  store2 = new Corestore(storageDir2)
  pairer = Room.pair(store2, invite, { schema })
  room2 = await pairer.resolve()
  await room2.ready()
  t.ok(room2, 'room2 paired')

  t.ok(room1.writable, 'room1 writable')
  t.ok(room2.writable, 'room2 writable')

  await room1.sendMessage('Hello from room1')

  const room2Messages = await waitForAtLeast(1, async () => {
    return await room2.allMessages()
  })

  t.is(room2Messages.length, 1, 'room2 received message')
  t.is(room2Messages[0].text, 'Hello from room1', 'correct message')

  await room2.sendMessage('Hello from room2')

  const room1Messages = await waitForAtLeast(1, async () => {
    return await room1.allMessages()
  })

  t.is(room1Messages.length, 2, 'room1 received both messages')
  const texts = room1Messages.map((m) => m.text).sort()
  t.alike(
    texts,
    ['Hello from room1', 'Hello from room2'].sort(),
    'both messages present'
  )
})
