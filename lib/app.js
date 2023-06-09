const fs = require('fs');
const fsp = fs.promises;
const {Duplex} = require('stream');
const path = require('path');
const {google} = require('googleapis');
const drive = google.drive('v3');
const once = require('@sarosia/once');
const { sleep, Seconds } = require('@sarosia/datetime').Duration;
const Apper = require('@sarosia/apper');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const app = new Apper('scantogdrive', async (ctx) => {
  const logger = ctx.logger;
  while (true) {
    await sleep(new Seconds(1));
    try {
      const files = await fsp.readdir(ctx.config.path);
      for (const file of files) {
        const filepath = path.join(ctx.config.path, file);
        logger.info(`Found new file ${filepath}.`);
        await waitForScannerCompletion(ctx, filepath);
        await sleep(new Seconds(1));
        await upload(ctx, filepath);
        await fsp.unlink(filepath);
      }
    } catch (e) {
      logger.error(`Unexpected error ${e}`);
    }
  }
}, {
    staticPaths: [
      path.resolve(`${__dirname}/../static`),
    ]
});

const initGoogleAuth = once(async () => {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const authClient = await auth.getClient();
  google.options({
    auth: authClient,
  });
});

async function upload(ctx, filepath) {
  const logger = ctx.logger;
  await initGoogleAuth();
  const res = await drive.files.list({
    q: "name contains 'Scanner'"
  });
  if (res.data.files.length == 0) {
    throw new Error("Cannot find shared folder 'Scanner'.");
  }
  const parent = res.data.files[0];
  try {
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const filename = `scan-${timestamp}.pdf`
    logger.info(`Uploading ${filename}...`);
    
    const content = await fsp.readFile(filepath);
    const stream = new Duplex();
    stream.push(content);
    stream.push(null);
    const file = await drive.files.create({
      resource: {
        name: filename,
        parents: [parent.id],
      },
      media: {
        body: stream
      },
    });
    logger.info(`Uploaded ${filename}.`);
  } catch (e) {
    logger.error(e);
  }
}

async function waitForScannerCompletion(ctx, filepath) {
  const logger = ctx.logger;
  while (true) {
    const { stdout, stderr } = await exec(
      'netstat -an | grep -E "\:445[ \t]+" | grep ESTABLISHED | wc -l');
    const numSambaConn = parseInt(stdout);
    logger.info(`Number of samba connection: ${numSambaConn}`);
    if (stdout == 0) {
      return;
    }
    await sleep(new Seconds(1));
  }
}

module.exports = function () {
  app.start();
};

