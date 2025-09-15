#!/usr/bin/env node
import { Manager } from './index.js'
import { Room } from './example/room.js'
import arg from 'arg'
import readline from 'readline'
import process from 'process'
import * as dispatch from './example/spec/dispatch/index.js'
import db from './example/spec/db/index.js'

const schema = { db, dispatch }

const cliArgs = arg({
  '-s': String,
  '--storage': '-s'
})

const baseStorage = cliArgs['-s'] || './storage/'
const manager = new Manager(baseStorage, {
  ContextClass: Room,
  schema
})

function printUsage () {
  console.log(`
Usage: node cli.js [options] <command> [args...]

Options:
  -s PATH          - Storage directory (default: ./storage/)

Commands:
  create [name]     - Create a new room
  join <invite>     - Join a room using an invite
  list             - List all rooms
  show <key>       - Show detailed room information and invite
  connect <key>    - Connect to a specific room
  remove <key>     - Remove/forget a room
  help             - Show this help

Examples:
  node cli.js create "My Room"
  node cli.js -s /tmp/rooms list
  node cli.js join z32InviteCodeHere
  node cli.js show abc123...
  node cli.js -s ./custom-storage connect abc123...
  node cli.js remove abc123...
`)
}

async function listRooms () {
  await manager.ready()
  const contexts = await manager.listContexts()

  if (contexts.length === 0) {
    console.log('No rooms found. Use "create" or "join" to add rooms.')
    return
  }

  console.log(`Found ${contexts.length} room(s):`)
  contexts.forEach((context, i) => {
    const age = Math.floor((Date.now() - context.lastUsed) / 1000 / 60)
    const creator = context.isCreator ? '(creator)' : '(joined)'
    console.log(`  ${i + 1}. ${context.name} ${creator}`)
    console.log(`     Key: ${context.key}`)
    console.log(`     Last used: ${age}m ago`)
  })
}

async function createRoom (name) {
  await manager.ready()
  console.log('Creating room...')

  const result = await manager.createContext({ name })
  console.log(`✅ Created room "${name}"`)
  console.log(`   Key: ${result.context.key.toString('hex')}`)
  console.log(`   Invite: ${result.invite}`)
  console.log('\nShare this invite with others to let them join!')
}

async function joinRoom (invite) {
  await manager.ready()
  console.log('Joining room...')

  const context = await manager.joinContext(invite)
  console.log('✅ Joined room')
  console.log(`   Key: ${context.key.toString('hex')}`)
}

async function connectToRoom (keyHex) {
  await manager.ready()

  const context = await manager.getContext(keyHex)
  if (!context) {
    console.log(`❌ Room ${keyHex} not found`)
    return
  }

  console.log(`🔗 Connected to room ${keyHex.slice(0, 8)}...`)
  console.log('Loading messages...')

  const messages = await context.allMessages()
  messages.forEach(msg => {
    console.log(`msg[${msg.index}]: ${msg.text}`)
  })

  context.subscribe(async () => {
    const last = await context.lastMessage()
    if (last) {
      console.log(`msg[${last.index}]: ${last.text}`)
    }
  })

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  function prompt () {
    rl.question('> ', async (input) => {
      if (input.trim() === '/quit') {
        await manager.close()
        process.exit(0)
      }

      if (input.trim()) {
        await context.sendMessage(input.trim())
      }

      setTimeout(prompt, 100)
    })
  }

  console.log('Type messages (or /quit to exit):')
  prompt()
}

async function showRoom (keyHex) {
  await manager.ready()

  const contexts = await manager.listContexts()
  const contextRecord = contexts.find(context => context.key === keyHex)

  if (!contextRecord) {
    console.log(`❌ Room ${keyHex.slice(0, 8)}... not found`)
    return
  }

  const context = await manager.getContext(keyHex)

  console.log('📋 Room Details')
  console.log(`   Name: ${contextRecord.name}`)
  console.log(`   Key: ${contextRecord.key}`)
  console.log(`   Encryption Key: ${contextRecord.encryptionKey}`)
  console.log(`   Created: ${new Date(contextRecord.createdAt).toLocaleString()}`)
  console.log(`   Last Used: ${new Date(contextRecord.lastUsed).toLocaleString()}`)
  console.log(`   Role: ${contextRecord.isCreator ? 'Creator' : 'Member'}`)

  console.log('\n🎟️ Generating invite...')
  try {
    const invite = await context.createInvite()
    console.log(`   Invite: ${invite}`)
    console.log('\n💡 Share this invite with others to let them join!')
  } catch (error) {
    if (contextRecord.isCreator) {
      console.log(`   ❌ Failed to generate invite: ${error.message}`)
    } else {
      console.log('   ⚠️  Only room creators can generate invites')
    }
  }

  try {
    const messages = await context.allMessages()
    console.log(`\n💬 Messages: ${messages.length} total`)

    if (messages.length > 0) {
      const latest = messages[messages.length - 1]
      console.log(`   Latest: "${latest.text}" (msg #${latest.index})`)
    }
  } catch (error) {
    console.log(`\n💬 Messages: Unable to load (${error.message})`)
  }
}

async function removeRoom (keyHex) {
  await manager.ready()

  const removed = await manager.removeContext(keyHex)
  if (removed) {
    console.log(`✅ Removed room ${keyHex.slice(0, 8)}...`)
  } else {
    console.log(`❌ Room ${keyHex.slice(0, 8)}... not found`)
  }
}

async function main () {
  const command = cliArgs._[0]

  try {
    switch (command) {
      case 'create': {
        const name = cliArgs._[1] || `Room ${Date.now()}`
        await createRoom(name)
        break
      }
      case 'join': {
        const invite = cliArgs._[1]
        if (!invite) {
          console.log('❌ Please provide an invite code')
          printUsage()
          process.exit(1)
        }
        await joinRoom(invite)
        break
      }
      case 'list': {
        await listRooms()
        break
      }
      case 'show': {
        const showKey = cliArgs._[1]
        if (!showKey) {
          console.log('❌ Please provide a room key')
          printUsage()
          process.exit(1)
        }
        await showRoom(showKey)
        break
      }
      case 'connect': {
        const keyHex = cliArgs._[1]
        if (!keyHex) {
          console.log('❌ Please provide a room key')
          printUsage()
          process.exit(1)
        }
        await connectToRoom(keyHex)
        break
      }
      case 'remove': {
        const removeKey = cliArgs._[1]
        if (!removeKey) {
          console.log('❌ Please provide a room key to remove')
          printUsage()
          process.exit(1)
        }
        await removeRoom(removeKey)
        break
      }
      case 'help':
      case undefined: {
        printUsage()
        break
      }
      default: {
        console.log(`❌ Unknown command: ${command}`)
        printUsage()
        process.exit(1)
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  } finally {
    if (!['connect'].includes(command)) {
      await manager.close()
    }
  }
}

main()
