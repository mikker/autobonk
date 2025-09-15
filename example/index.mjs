import { Manager } from '../index.js'
import { Room } from './room.js'
import arg from 'arg'
import readline from 'readline'
import * as dispatch from './spec/dispatch/index.js'
import db from './spec/db/index.js'

const schema = { db, dispatch }

const args = arg({
  '-s': String,
  '--storage': '-s'
})

const baseStorage = args['-s'] || './storage/'
const invite = args._[0]

const manager = new Manager(baseStorage, {
  ContextClass: Room,
  schema
})

let currentRoom = null

async function onUpdate () {
  if (!currentRoom) return
  const last = await currentRoom.lastMessage()
  if (last) {
    console.log(`msg[${last.index}]: ${last.text}`)
  }
}

function print (message) {
  console.log(`msg[${message.index}]: ${message.text}`)
}

async function main () {
  await manager.ready()

  if (invite) {
    console.log('Joining room...')
    currentRoom = await manager.joinContext(invite)
    console.log('✅ Joined room')
  } else {
    const contexts = await manager.listContexts()

    if (contexts.length > 0) {
      console.log(`Found ${contexts.length} existing context(s). Using: ${contexts[0].name}`)
      currentRoom = await manager.getContext(contexts[0].key)
    } else {
      console.log('Creating new room...')
      const result = await manager.createContext({ name: 'Chat Room' })
      currentRoom = result.context
      console.log('✅ Created new room')
    }
  }

  try {
    const roomInvite = await currentRoom.createInvite()
    console.log(`\n🎟️  Room invite: ${roomInvite}`)
    console.log('💡 Share this invite with others to let them join!\n')
  } catch (error) {
    console.log(`\n⚠️  Could not generate invite: ${error.message}\n`)
  }

  const messages = await currentRoom.allMessages()
  console.log(`Found ${messages.length} existing message(s):`)
  messages.forEach(print)

  currentRoom.subscribe(onUpdate)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  function prompt () {
    rl.question('Enter message (or /quit to exit): ', async (answer) => {
      if (answer.trim() === '/quit') {
        await manager.close()
        process.exit(0)
      }

      if (answer.trim() === '/contexts') {
        const contexts = await manager.listContexts()
        console.log(`\nAll contexts (${contexts.length}):`)
        contexts.forEach((context, i) => {
          const age = Math.floor((Date.now() - context.lastUsed) / 1000 / 60)
          console.log(`  ${i + 1}. ${context.name} (${context.key.slice(0, 8)}...) - ${age}m ago`)
        })
        console.log()
        setTimeout(prompt, 100)
        return
      }

      if (answer.trim()) {
        await currentRoom.sendMessage(answer.trim())
      }

      setTimeout(prompt, 100)
    })
  }

  console.log('\nCommands: /contexts (list contexts), /quit (exit)')
  prompt()
}

main().catch(console.error)
