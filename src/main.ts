import { mkdtempSync, rmSync } from 'node:fs'
import { zValidator } from '@hono/zod-validator'
import { $ } from 'bun'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { logger } from 'hono/logger'
import { Hono } from 'hono/quick'
import { z } from 'zod'

const MEMORY_LIMIT = '500m'
const FILE_SIZE_LIMIT = 1 * 1024 * 1024 // 1MB

const app = new Hono()
// log requests
app.use(logger())
// handle errors
app.onError((err, c) => {
  console.error(`Unexpected error: ${err}`)
  return c.text('Unexpected error', 500)
})
// set CORS
app.use('*', cors())
// create temp dir
// biome-ignore lint/style/useNamingConvention:
const tempDirMiddleware = createMiddleware<{ Variables: { out: string } }>(
  async (c, next) => {
    // create temp dir
    const out = mkdtempSync('out-')
    c.set('out', out)
    try {
      await next()
    } finally {
      // remove temp dir
      rmSync(out, { recursive: true })
    }
  },
)
// validate request
const validator = zValidator(
  'form',
  z.object({
    formula: z.string().nonempty(),
    bussproofs: z.literal('on').optional(),
    ebproof: z.literal('on').optional(),
    timeout: z.enum(['3', '5', '10']),
  }),
)

app.post('/', validator, tempDirMiddleware, async c => {
  // get form
  const form = c.req.valid('form')
  console.info(form)
  const { formula, bussproofs, ebproof, timeout } = form
  // get temp dir
  const out = c.get('out')
  // run prover
  console.info('Proving...')
  const { stderr, exitCode } =
    await $`timeout ${timeout} java -jar -Xmx${MEMORY_LIMIT} prover.jar ${formula} ${out} ${FILE_SIZE_LIMIT} ${bussproofs ? '--format=bussproofs' : ''} ${ebproof ? '--format=ebproof' : ''}`.nothrow()
  // get text
  let text = await Bun.file(`${out}/prover-log.txt`).text()
  // timeout
  if (exitCode === 124) {
    text += 'Failed: Timeout'
  }
  // OutOfMemoryError
  if (stderr.includes('OutOfMemoryError')) {
    text += 'Failed: OutOfMemoryError'
  }
  // StackOverflowError
  if (stderr.includes('StackOverflowError')) {
    text += 'Failed: StackOverflowError'
  }
  console.info('Done!')
  console.info(text)
  return c.json({
    text: text,
    bussproofs: (await Bun.file(`${out}/out-bussproofs.tex`).exists())
      ? await Bun.file(`${out}/out-bussproofs.tex`).text()
      : undefined,
    ebproof: (await Bun.file(`${out}/out-ebproof.tex`).exists())
      ? await Bun.file(`${out}/out-ebproof.tex`).text()
      : undefined,
  })
})

export default app
