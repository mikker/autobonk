#!/usr/bin/env node
import arg from 'arg'
import readline from 'readline'
import process from 'process'
import { Manager } from '../../index.js'
import { Room } from './room.js'
import * as dispatch from './spec/dispatch/index.js'
import db from './spec/db/index.js'

class CliUsageError extends Error {}

const schema = { db, dispatch }
const cliArgs = arg({
  '-s': String,
  '--storage': '-s',
  '-h': Boolean,
  '--help': '-h'
})

if (cliArgs['-h']) {
  printUsage()
  process.exit(0)
}

const storagePath = cliArgs['-s'] || './example/storage/'
const manager = new Manager(storagePath, {
  ContextClass: Room,
  schema
})

let closePromise = null
function closeManager() {
  if (!closePromise) {
    closePromise = manager.close()
  }
  return closePromise
}

let interactiveActive = false

function printUsage() {
  console.log(`
Usage: node example/basic/cli.js [options] <command> [args...]

Options:
  -s PATH          Storage directory (default: ./example/storage/)
  -h, --help       Show this help

Commands:
  create [name]    Create a room and share an invite
  join <invite>    Join a room via invite code
  list             List stored rooms
  connect <key>    Open a room and chat (/quit to exit)
  help             Show this help

Examples:
  node example/basic/basic.js              # sequential walk-through
  node example/basic/cli.js create 'My Room'
  node example/basic/cli.js -s /tmp/autobonk-basic list
  node example/basic/cli.js connect <hexkey>
`)
}

function shortKey(key) {
  const hex = typeof key === 'string' ? key : key.toString('hex')
  return hex.length > 12 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex
}

function logMessage(msg) {
  const index = typeof msg.index === 'number' ? msg.index : '?'
  const text = msg.text || JSON.stringify(msg)
  console.log(`[${index}] ${text}`)
}

async function listRooms() {
  await manager.ready()
  const contexts = await manager.listContexts()

  if (!contexts.length) {
    console.log('No rooms found. Use "create" or "join" to get started.')
    return
  }

  contexts.forEach((ctx, i) => {
    const name = ctx.name || `Room ${shortKey(ctx.key)}`
    const role = ctx.isCreator ? 'creator' : 'member'
    console.log(`${i + 1}. ${name} (${role}) — ${shortKey(ctx.key)}`)
  })
}

async function createRoom(nameArg) {
  await manager.ready()
  const name = nameArg || `Room ${Date.now()}`

  const context = await manager.createContext({ name })
  const keyHex = context.key.toString('hex')
  const invite = await context.createInvite()

  console.log(`Created room "${name}"`)
  console.log(`Key: ${keyHex}`)
  console.log(`Invite: ${invite}`)

  const invites = await context.listInvites()
  invites.forEach((entry, index) => {
    const inviteId = entry.id.toString('hex')
    const shortId =
      inviteId.length > 12
        ? `${inviteId.slice(0, 8)}…${inviteId.slice(-4)}`
        : inviteId
    console.log(`Invite ${index + 1} id: ${shortId}`)
  })
}

async function joinRoom(invite) {
  if (!invite) {
    throw new CliUsageError('An invite code is required to join a room.')
  }

  await manager.ready()
  const context = await manager.joinContext(invite)
  const keyHex = context.key.toString('hex')

  console.log(`Joined room — key ${keyHex}`)
}

async function connectToRoom(keyHex) {
  if (!keyHex) {
    throw new CliUsageError('Provide the room key you want to connect to.')
  }

  await manager.ready()
  const context = await manager.getContext(keyHex)

  if (!context) {
    throw new CliUsageError(`No stored room matches ${keyHex}`)
  }

  const contexts = await manager.listContexts()
  const record = contexts.find((ctx) => ctx.key === keyHex)
  const roomName = record ? record.name : `Room ${shortKey(keyHex)}`

  console.log(`Connected to ${roomName} (${shortKey(keyHex)})`)
  console.log('Type messages to send them. Use /quit to leave.')

  const existing = await context.allMessages()
  let latestIndex = 0

  if (!existing.length) {
    console.log('(no messages yet)')
  } else {
    existing.forEach((msg) => {
      if (typeof msg.index === 'number') {
        latestIndex = Math.max(latestIndex, msg.index)
      }
      logMessage(msg)
    })
  }

  let unsubscribed = false
  const unsubscribe = context.subscribe(async () => {
    try {
      const last = await context.lastMessage()
      if (last && typeof last.index === 'number' && last.index > latestIndex) {
        latestIndex = last.index
        logMessage(last)
      }
    } catch (error) {
      console.error('Failed to read latest message:', error.message)
    }
  })

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  interactiveActive = true

  rl.on('line', (line) => {
    const input = line.trim()

    if (!input) {
      rl.prompt()
      return
    }

    if (input === '/quit') {
      rl.close()
      return
    }

    context
      .sendMessage(input)
      .then(() => {
        if (!rl.closed) rl.prompt()
      })
      .catch((error) => {
        console.error('Failed to send message:', error.message)
        if (!rl.closed) rl.prompt()
      })
  })

  rl.on('SIGINT', () => {
    console.log('\nExiting...')
    rl.close()
  })

  rl.on('close', () => {
    if (!unsubscribed) {
      unsubscribed = true
      unsubscribe()
    }

    closeManager()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Error while closing manager:', error.message)
        process.exit(1)
      })
  })

  rl.setPrompt('> ')
  rl.prompt()
}

async function main() {
  const command = cliArgs._[0]

  if (!command || command === 'help') {
    printUsage()
    return
  }

  try {
    switch (command) {
      case 'create':
        await createRoom(cliArgs._[1])
        break
      case 'join':
        await joinRoom(cliArgs._[1])
        break
      case 'list':
        await listRooms()
        break
      case 'connect':
        await connectToRoom(cliArgs._[1])
        return
      default:
        throw new CliUsageError(`Unknown command: ${command}`)
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message)
      printUsage()
    } else {
      console.error('Error:', error.message)
    }
    process.exitCode = 1
  } finally {
    if (command !== 'connect' || !interactiveActive) {
      try {
        await closeManager()
      } catch (error) {
        console.error('Error while closing manager:', error.message)
        process.exitCode = 1
      }
    }
  }
}

main()
