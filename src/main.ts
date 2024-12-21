import { mkdtempSync, rmSync } from 'node:fs'
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

app.post('/', tempDirMiddleware, async c => {
  const body = await c.req.json()
  const result = z
    .object({
      sequent: z.string().min(1),
      bussproofs: z.boolean(),
      ebproof: z.boolean(),
      timeout: z.number().min(0).max(10),
    })
    .safeParse(body)
  if (!result.success) {
    console.error(`Invalid Request: ${result.error}`)
    return c.text('Invalid Request', 400)
  }
  const { sequent, bussproofs, ebproof, timeout } = result.data
  const format: string[] = []
  if (bussproofs) {
    format.push('bussproofs')
  }
  if (ebproof) {
    format.push('ebproof')
  }
  const out = c.get('out')
  // run prover
  console.info('Proving...')
  const { stdout, stderr, exitCode } =
    await $`timeout ${timeout} java -jar -Xmx500m prover.jar ${sequent} ${out} --format=${format.join(',')}`
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
    return c.text(`${stdout}\nFailed: Timeout`)
  }
  // OutOfMemoryError
  if (stderr.includes('OutOfMemoryError')) {
    console.error('Failed: OutOfMemoryError')
    return c.text(`${stdout}\nFailed: OutOfMemoryError`)
  }
  // StackOverflowError
  if (stderr.includes('StackOverflowError')) {
    console.error('Failed: StackOverflowError')
    return c.text(`${stdout}\nFailed: StackOverflowError`)
  }
  // Unexpected error
  if (
    (bussproofs && !(await Bun.file(`${out}/out-bussproofs.tex`).exists())) ||
    (ebproof && !(await Bun.file(`${out}/out-ebproof.tex`).exists()))
  ) {
    console.error('Failed: Unexpected error')
    console.info(`${stderr}`)
    return c.text(`${stdout}\nFailed: Unexpected error`)
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
})

export default app
