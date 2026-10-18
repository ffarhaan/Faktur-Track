import { connect } from "@tidbcloud/serverless";

const databaseUrl =
  process.env.DATABASE_URL ||
  "mysql://3DfsJSnw7rByU61.root:Dpit5LwtKBfe2eYl@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test?ssl={\"rejectUnauthorized\":true}";

export function getTiDBClient() {
  return connect({ url: databaseUrl });
}
