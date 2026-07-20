import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1784552761338 implements MigrationInterface {
    name = 'MigrationName1784552761338'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" ADD "recurrenceRule" jsonb`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "recurrenceParentId" uuid`);
        await queryRunner.query(`ALTER TABLE "users" ADD "telegramToken" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_5d03187613c5c33a458821cba6d" UNIQUE ("telegramToken")`);
        await queryRunner.query(`ALTER TABLE "users" ADD "telegramChatId" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "vibes" text array NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "preferences" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`CREATE INDEX "IDX_9a16d2c86252529f622fa53f1e" ON "tasks" ("assigneeId") `);
        await queryRunner.query(`CREATE INDEX "IDX_TASKS_STATS_COVERING" ON "tasks" ("householdId", "assigneeId", "taskTypeId", "status", "dueDate", "points") `);
        await queryRunner.query(`CREATE INDEX "IDX_a6ad41b380dcb046ef9992767a" ON "tasks" ("householdId", "dueDate") `);
        await queryRunner.query(`CREATE INDEX "IDX_1d7dab2ad94a6005d07a7293ff" ON "tasks" ("householdId", "updatedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_c45a52afcb0568d9d2f74d7bfa" ON "tasks" ("householdId", "status") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_c45a52afcb0568d9d2f74d7bfa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1d7dab2ad94a6005d07a7293ff"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a6ad41b380dcb046ef9992767a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_TASKS_STATS_COVERING"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9a16d2c86252529f622fa53f1e"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "preferences"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "vibes"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "telegramChatId"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_5d03187613c5c33a458821cba6d"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "telegramToken"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "recurrenceParentId"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "recurrenceRule"`);
    }

}
