import { mkdtempSync, rmSync } from 'node:fs'
import { zValidator } from '@hono/zod-validator'
import { $ } from 'bun'
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
  zValidator(
    'form',
    z.object({
      formula: z.string().nonempty(),
      format: z.array(z.enum(['bussproofs', 'ebproof'])).optional(),
      timeout: z.enum(['3', '5', '10']),
    }),
  ),
  tempDirMiddleware,
  async c => {
    const form = c.req.valid('form')
    console.info(form)
    const { formula, format, timeout } = form
    const out = c.get('out')
    // run prover
    console.info('Proving...')
    const { stdout, stderr, exitCode } =
      await $`timeout ${timeout} java -jar -Xmx500m prover.jar ${formula} ${out} --format=${format?.join(',')}`
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
      (format?.includes('bussproofs') &&
        !(await Bun.file(`${out}/out-bussproofs.tex`).exists())) ||
      (format?.includes('ebproof') &&
        !(await Bun.file(`${out}/out-ebproof.tex`).exists()))
    ) {
      console.error('Failed: Unexpected error')
      console.info(`${stderr}`)
      return c.text(`${stdout}Failed: Unexpected error`)
    }
    console.info('Done!')
    return c.json({
      text: `${stdout}`,
      bussproofs: format?.includes('bussproofs')
        ? await Bun.file(`${out}/out-bussproofs.tex`).text()
        : undefined,
      ebproof: format?.includes('ebproof')
        ? await Bun.file(`${out}/out-ebproof.tex`).text()
        : undefined,
    })
  },
)

export default app
