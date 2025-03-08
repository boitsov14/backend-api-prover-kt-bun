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
  return c.text('Unexpected error')
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
  'json',
  z.object({
    formula: z.string().nonempty(),
    bussproofs: z.boolean(),
    ebproof: z.boolean(),
    timeout: z.number().int().positive().max(10),
  }),
)

app.post('/', validator, tempDirMiddleware, async c => {
  // get json
  const json = c.req.valid('json')
  console.info(json)
  const { formula, bussproofs, ebproof, timeout } = json
  // get temp dir
  const out = c.get('out')
  // save formula as file
  await Bun.write(`${out}/formula.txt`, formula)
  // run prover
  console.info('Proving...')
  const { stderr, exitCode } =
    await $`timeout ${timeout} java -jar -Xmx${MEMORY_LIMIT} prover.jar ${out} ${FILE_SIZE_LIMIT} ${bussproofs ? '--format=bussproofs' : ''} ${ebproof ? '--format=ebproof' : ''}`.nothrow()
  console.info(`exit code: ${exitCode}`)
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
  // set result
  const result = {
    text: text,
    formula: (await Bun.file(`${out}/formula.tex`).exists())
      ? await Bun.file(`${out}/formula.tex`).text()
      : undefined,
    proofs: {
      bussproofs: (await Bun.file(`${out}/out-bussproofs.tex`).exists())
        ? await Bun.file(`${out}/out-bussproofs.tex`).text()
        : undefined,
      ebproof: (await Bun.file(`${out}/out-ebproof.tex`).exists())
        ? await Bun.file(`${out}/out-ebproof.tex`).text()
        : undefined,
    },
  }
  // log result
  console.info({
    text: result.text,
    formula: result.formula?.substring(0, 100),
    bussproofs: result.proofs.bussproofs?.substring(0, 100),
    bussproofsSize: result.proofs.bussproofs
      ? Buffer.byteLength(result.proofs.bussproofs)
      : undefined,
    ebproof: result.proofs.ebproof?.substring(0, 100),
    ebproofSize: result.proofs.ebproof
      ? Buffer.byteLength(result.proofs.ebproof)
      : undefined,
  })
  return c.json(result)
})

export default {
  // biome-ignore lint/complexity/useLiteralKeys:
  port: Bun.env['PORT'] || 8080,
  fetch: app.fetch,
}
