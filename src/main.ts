import { mkdtempSync, rmSync } from 'node:fs'
import { zValidator } from '@hono/zod-validator'
import { $ } from 'bun'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { logger } from 'hono/logger'
import { Hono } from 'hono/quick'
import { z } from 'zod'

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

app.post(
  '/',
  // validate request
  zValidator(
    'form',
    z.object({
      formula: z.string().nonempty(),
      bussproofs: z.literal('on').optional(),
      ebproof: z.literal('on').optional(),
      timeout: z.enum(['3', '5', '10']),
    }),
  ),
  tempDirMiddleware,
  async c => {
    const form = c.req.valid('form')
    console.info(form)
    const { formula, bussproofs, ebproof, timeout } = form
    const out = c.get('out')
    // run prover
    console.info('Proving...')
    const { stdout, stderr, exitCode } =
      await $`timeout ${timeout} java -jar -Xmx500m prover.jar ${formula} ${out} ${bussproofs ? '--bussproofs' : ''} ${ebproof ? '--ebproof' : ''}`
        .nothrow()
        .quiet()
    // parse error
    if (stdout.includes('Parse Error')) {
      console.error('Failed: Parse Error')
      return c.text(`${stdout}`)
    }
    // timeout
    if (exitCode === 124) {
      console.error('Failed: Timeout')
      return c.text(`${stdout}Failed: Timeout`)
    }
    // OutOfMemoryError
    if (stderr.includes('OutOfMemoryError')) {
      console.error('Failed: OutOfMemoryError')
      return c.text(`${stdout}Failed: OutOfMemoryError`)
    }
    // StackOverflowError
    if (stderr.includes('StackOverflowError')) {
      console.error('Failed: StackOverflowError')
      return c.text(`${stdout}Failed: StackOverflowError`)
    }
    // Unexpected error
    if (
      (bussproofs && !(await Bun.file(`${out}/out-bussproofs.tex`).exists())) ||
      (ebproof && !(await Bun.file(`${out}/out-ebproof.tex`).exists()))
    ) {
      console.error('Failed: Unexpected error')
      console.info(`${stderr}`)
      return c.text(`${stdout}Failed: Unexpected error`)
    }
    console.info('Done!')
    return c.json({
      text: `${stdout}`,
      bussproofs: bussproofs
        ? await Bun.file(`${out}/out-bussproofs.tex`).text()
        : undefined,
      ebproof: ebproof
        ? await Bun.file(`${out}/out-ebproof.tex`).text()
        : undefined,
    })
  },
)

export default app
