import { Context } from '../index.js'
import crypto from 'hypercore-crypto'
import Corestore from 'corestore'
import process from 'process'
import readline from 'readline'
import * as dispatch from './spec/dispatch/index.js'
import db from './spec/db/index.js'

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

const baseStorage = './storage/'
let bonk = null

if (process.argv[2]) {
  const invite = process.argv[2]
  const store = new Corestore(baseStorage + invite.slice(0, 8))
  const pair = Room.pair(store, invite, { schema })
  bonk = await pair.resolve()
  console.log('pair')
} else {
  const store = new Corestore(baseStorage + Date.now())
  bonk = new Room(store, { schema })
  await bonk.ready()
  const invite = await bonk.createInvite()
  console.log('Created new room with invite:', invite)
}

await bonk.ready()

bonk.allMessages().then((messages) => {
  messages.forEach(print)
})

async function onupdate() {
  const last = await bonk.lastMessage()
  print(last)
}

function print(message) {
  console.log(`msg[${message.index}]: ${message.text}`)
}

bonk.subscribe(onupdate)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function prmpt() {
  rl.question('Enter something: ', async (answer) => {
    await bonk.sendMessage(answer)
    setTimeout(prmpt, 100)
  })
}

prmpt()
