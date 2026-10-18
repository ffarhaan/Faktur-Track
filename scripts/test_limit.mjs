import { connect } from "@tidbcloud/serverless";

const tidbUrl =
  'mysql://3DfsJSnw7rByU61.root:Dpit5LwtKBfe2eYl@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test?ssl={"rejectUnauthorized":true}';

async function test() {
  const conn = connect({ url: tidbUrl });
  const rows = await conn.execute("SELECT invoice_key FROM fakturs_archive;");
  console.log("Returned rows without limit:", rows.length);

  const rowsLimit = await conn.execute("SELECT invoice_key FROM fakturs_archive LIMIT 50000;");
  console.log("Returned rows with LIMIT 50000:", rowsLimit.length);
}

test().catch(console.error);
