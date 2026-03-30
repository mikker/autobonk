import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import test from 'brittle'

import { Manager } from '../index.js'
import { Room } from '../example/basic/room.js'
import * as dispatch from '../example/basic/spec/dispatch/index.js'
import db from '../example/basic/spec/db/index.js'

const schema = { db, dispatch }

test('manager reuses one network across contexts', async (t) => {
  t.plan(6)

  const testId = Date.now()
  const storageDir = join(tmpdir(), 'autobonk-test', `manager-${testId}`)

  let manager = null

  t.teardown(async () => {
    if (manager && !manager.closed) await manager.close()
    rmSync(storageDir, { recursive: true, force: true })
  })

  manager = new Manager(storageDir, {
    ContextClass: Room,
    schema
  })
  await manager.ready()

  const room1 = await manager.createContext({ name: 'Room 1' })
  const room2 = await manager.createContext({ name: 'Room 2' })
  const sharedNetwork = room1.network
  const sharedSwarm = room1.swarm

  t.is(room1.network, room2.network, 'contexts share the manager network')
  t.is(room1.swarm, room2.swarm, 'contexts share the manager swarm')

  await room1.close()

  t.is(sharedSwarm.destroyed, false, 'closing one context leaves the app swarm running')

  const invite = await room2.createInvite()
  t.ok(invite, 'remaining context still works after another context closes')

  await manager.close()
  manager = null

  t.is(sharedNetwork.closed, true, 'manager close destroys the shared network')
  t.is(sharedSwarm.destroyed, true, 'manager close destroys the shared swarm')
})
