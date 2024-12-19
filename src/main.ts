import { mkdtempSync, rmSync } from 'node:fs'
import { $ } from 'bun'
import { createMiddleware } from 'hono/factory'
import { logger } from 'hono/logger'
import { Hono } from 'hono/quick'

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
  // get tex
  const tex = await c.req.text()
  // save file to temp directory
  const out = c.get('out')
  await Bun.write(`${out}/out.tex`, tex)
  // run pdflatex
  console.info('Generating PDF...')
  let text = 'Generating PDF...\n'
  const pdf =
    await $`pdflatex -halt-on-error -interaction=nonstopmode -output-directory ${out} ${out}/out.tex`
      .nothrow()
      .quiet()
  // Dimension too large
  if (pdf.stdout.includes('Dimension too large')) {
    console.error('Failed: Dimension too large')
    text += 'Failed: Dimension too large'
    return c.text(text)
  }
  // if pdf does not exist
  if (!(await Bun.file(`${out}/out.pdf`).exists())) {
    console.error('Failed: Unexpected error')
    console.info(`${pdf.stdout}\n${pdf.stderr}`)
    text += 'Failed: Unexpected error'
    return c.text(text)
  }
  console.info('Done!')
  text += 'Done!\n'
  // convert pdf to png
  console.info('Generating PNG...')
  text += 'Generating PNG...\n'
  const png =
    await $`gswin64c -dBATCH -dNOPAUSE -r600 -sDEVICE=pngmono -o "${out}/out.png" "${out}/out.pdf"`
      .nothrow()
      .quiet()
  // if png does not exist
  if (!(await Bun.file(`${out}/out.png`).exists())) {
    console.error('Failed: Unexpected error')
    console.info(`${png.stdout}\n${png.stderr}`)
    text += 'Failed: Unexpected error'
    return c.text(text)
  }
  console.info('Done!')
  // read png as buffer
  const buffer = await Bun.file(`${out}/out.png`).arrayBuffer()
  c.header('Content-Type', 'image/png')
  // c.header('Content-Length', buffer.byteLength.toString())
  // c.header('Content-Disposition', 'attachment; filename=out.png')
  return c.body(buffer)
})

export default app
