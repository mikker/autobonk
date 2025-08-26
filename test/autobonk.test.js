import test from 'brittle'
import { Context } from '../index.js'
import Corestore from 'corestore'
import * as dispatch from '../example/spec/dispatch/index.js'
import db from '../example/spec/db/index.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'

const schema = { db, dispatch }

class Room extends Context {
  _setupRoutes() {
    super._setupRoutes()

    this.router.add('@room/send-message', async (data, context) => {
      const last = await this.lastMessage()
      const index = last ? last.index + 1 : 1

      await context.view.insert('@room/messages', {
        index,
        ...data
      })
    })
  }

  async allMessages() {
    const messages = await this.base.view.find('@room/messages').toArray()
    return messages
  }

  async sendMessage(text) {
    await this.base.append(dispatch.encode('@room/send-message', { text }))
  }

  async lastMessage() {
    return await this.base.view.findOne('@room/messages', {
      reverse: true,
      limit: 1
    })
  }
}

test('two autobonks communicate bidirectionally', async (t) => {
  const testId = Date.now()
  const baseDir = join(tmpdir(), 'autobonk-test')
  const storageDir1 = join(baseDir, `room1-${testId}`)
  const storageDir2 = join(baseDir, `room2-${testId}`)

  let room1, room2

  try {
    const store1 = new Corestore(storageDir1)
    room1 = new Room(store1, { schema })
    await room1.ready()

    const invite = await room1.createInvite()
    t.ok(invite, 'invite created')

    const store2 = new Corestore(storageDir2)
    const pairer = Room.pair(store2, invite, { schema })
    room2 = await pairer.resolve()
    await room2.ready()
    t.ok(room2, 'room2 paired')

    // Wait for rooms to be writable
    let attempts = 0
    while (!room1.writable || !room2.writable) {
      if (attempts++ > 100) throw new Error('Rooms not writable')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // room1 → room2
    await room1.sendMessage('Hello from room1')

    let room2Messages
    attempts = 0
    do {
      if (attempts++ > 50) throw new Error('Message sync timeout')
      await new Promise((resolve) => setTimeout(resolve, 100))
      room2Messages = await room2.allMessages()
    } while (room2Messages.length === 0)

    t.is(room2Messages.length, 1, 'room2 received message')
    t.is(room2Messages[0].text, 'Hello from room1', 'correct message')

    // room2 → room1
    await room2.sendMessage('Hello from room2')

    let room1Messages
    attempts = 0
    do {
      if (attempts++ > 50) throw new Error('Reverse message sync timeout')
      await new Promise((resolve) => setTimeout(resolve, 100))
      room1Messages = await room1.allMessages()
    } while (room1Messages.length < 2)

    t.is(room1Messages.length, 2, 'room1 received both messages')
    const texts = room1Messages.map((m) => m.text).sort()
    t.alike(
      texts,
      ['Hello from room1', 'Hello from room2'].sort(),
      'both messages present'
    )
  } finally {
    if (room1) await room1.close()
    if (room2) await room2.close()
    try {
      rmSync(baseDir, { recursive: true, force: true })
    } catch (err) {}
  }
})
