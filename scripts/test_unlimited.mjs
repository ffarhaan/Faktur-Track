import { connect } from "@tidbcloud/serverless";

const tidbUrl =
  'mysql://3DfsJSnw7rByU61.root:Dpit5LwtKBfe2eYl@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test?ssl={"rejectUnauthorized":true}';

async function testUnlimited() {
  const conn = connect({ url: tidbUrl });

  // Test 1: 18446744073709551615 (MySQL UINT64 MAX)
  try {
    const res1 = await conn.execute("SELECT invoice_key FROM fakturs_archive LIMIT 18446744073709551615;");
    console.log("Returned rows with UINT64 MAX limit:", res1.length);
  } catch (err) {
    console.warn("UINT64 MAX error:", err.message);
  }

  // Test 2: 9223372036854775807 (BIGINT SIGNED MAX)
  try {
    const res2 = await conn.execute("SELECT invoice_key FROM fakturs_archive LIMIT 9223372036854775807;");
    console.log("Returned rows with BIGINT SIGNED MAX limit:", res2.length);
  } catch (err) {
    console.warn("BIGINT SIGNED MAX error:", err.message);
  }
}

testUnlimited().catch(console.error);
