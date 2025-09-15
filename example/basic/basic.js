import { Manager } from '../../index.js'
import { Room } from './room.js'
import * as dispatch from './spec/dispatch/index.js'
import db from './spec/db/index.js'

const schema = { db, dispatch }
const manager = new Manager('./example/storage/', {
  ContextClass: Room,
  schema
})

async function example() {
  await manager.ready()

  const room = await manager.createContext({ name: 'My Chat Room' })
  const invite = await room.createInvite()

  console.log('🍐 Created room:', room.key.toString('hex').slice(0, 8))
  console.log('🍐 Invite:', invite)

  const activeInvites = await room.listInvites()
  console.log(
    '🍐 Stored invites:',
    activeInvites.map((entry) => entry.id.toString('hex').slice(0, 12))
  )

  await room.sendMessage('Hello, world!')
  const messages = await room.allMessages()
  console.log('🍐 Messages:', messages.length)

  const contexts = await manager.listContexts()
  console.log('🍐 Total contexts:', contexts.length)

  const keyHex = room.key.toString('hex')
  const retrieved = await manager.getContext(keyHex)
  console.log('🍐 Retrieved same context:', retrieved === room)

  await manager.close()
  console.log('🍐 Manager closed')
}

example().catch(console.error)
