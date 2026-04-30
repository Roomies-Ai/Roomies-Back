import { MigrationInterface, QueryRunner } from "typeorm";

export class HouseTypeOnDeleteSetNull1777547881533 implements MigrationInterface {
    name = 'HouseTypeOnDeleteSetNull1777547881533'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "task_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "householdId" uuid, CONSTRAINT "PK_232576669c4df1f0a15e1300ce2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."tasks_status_enum" AS ENUM('pending', 'in-progress', 'completed', 'overdue')`);
        await queryRunner.query(`CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "description" text NOT NULL, "status" "public"."tasks_status_enum" NOT NULL DEFAULT 'pending', "dueDate" TIMESTAMP, "points" integer NOT NULL DEFAULT '1', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "taskTypeId" uuid, "householdId" uuid, "assigneeId" uuid, CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "pets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "kind" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "householdId" uuid, CONSTRAINT "PK_d01e9e7b4ada753c826720bee8b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "house_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_f49fbd231de6818ac0f2c82211d" UNIQUE ("name"), CONSTRAINT "PK_17b989eaaf44d0176e95b591cc1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "households" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "inviteCode" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "houseTypeId" uuid, CONSTRAINT "UQ_422469a6ea94e4822ad3b8fee84" UNIQUE ("inviteCode"), CONSTRAINT "PK_2b1aef2640717132e9231aac756" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "profilePicture" character varying, "refreshTokens" text array NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users_households_households" ("usersId" uuid NOT NULL, "householdsId" uuid NOT NULL, CONSTRAINT "PK_bab8460b90f7649eb88cafbf683" PRIMARY KEY ("usersId", "householdsId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b7b5e468f71266e9bf5ea446d3" ON "users_households_households" ("usersId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d8452d4a9c64c0c822841db1b2" ON "users_households_households" ("householdsId") `);
        await queryRunner.query(`CREATE TABLE "users_preferred_task_types_task_types" ("usersId" uuid NOT NULL, "taskTypesId" uuid NOT NULL, CONSTRAINT "PK_ce0e750a7cdc0d4b40493885e62" PRIMARY KEY ("usersId", "taskTypesId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_440cacf9f7e8d07e76057e5546" ON "users_preferred_task_types_task_types" ("usersId") `);
        await queryRunner.query(`CREATE INDEX "IDX_129afebaa837c478366048522e" ON "users_preferred_task_types_task_types" ("taskTypesId") `);
        await queryRunner.query(`ALTER TABLE "task_types" ADD CONSTRAINT "FK_d9c5f5c9474dfcca755a032020c" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_87fc96ddd3cf917315d4c69bdc3" FOREIGN KEY ("taskTypeId") REFERENCES "task_types"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_76cae6196c9ecff65d3ed796b34" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_9a16d2c86252529f622fa53f1e3" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pets" ADD CONSTRAINT "FK_1f9d8d87c46694b6a8793152374" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "households" ADD CONSTRAINT "FK_8cadafb7d81d2d118b553aae424" FOREIGN KEY ("houseTypeId") REFERENCES "house_types"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users_households_households" ADD CONSTRAINT "FK_b7b5e468f71266e9bf5ea446d34" FOREIGN KEY ("usersId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "users_households_households" ADD CONSTRAINT "FK_d8452d4a9c64c0c822841db1b23" FOREIGN KEY ("householdsId") REFERENCES "households"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users_preferred_task_types_task_types" ADD CONSTRAINT "FK_440cacf9f7e8d07e76057e55460" FOREIGN KEY ("usersId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "users_preferred_task_types_task_types" ADD CONSTRAINT "FK_129afebaa837c478366048522e9" FOREIGN KEY ("taskTypesId") REFERENCES "task_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users_preferred_task_types_task_types" DROP CONSTRAINT "FK_129afebaa837c478366048522e9"`);
        await queryRunner.query(`ALTER TABLE "users_preferred_task_types_task_types" DROP CONSTRAINT "FK_440cacf9f7e8d07e76057e55460"`);
        await queryRunner.query(`ALTER TABLE "users_households_households" DROP CONSTRAINT "FK_d8452d4a9c64c0c822841db1b23"`);
        await queryRunner.query(`ALTER TABLE "users_households_households" DROP CONSTRAINT "FK_b7b5e468f71266e9bf5ea446d34"`);
        await queryRunner.query(`ALTER TABLE "households" DROP CONSTRAINT "FK_8cadafb7d81d2d118b553aae424"`);
        await queryRunner.query(`ALTER TABLE "pets" DROP CONSTRAINT "FK_1f9d8d87c46694b6a8793152374"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_9a16d2c86252529f622fa53f1e3"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_76cae6196c9ecff65d3ed796b34"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_87fc96ddd3cf917315d4c69bdc3"`);
        await queryRunner.query(`ALTER TABLE "task_types" DROP CONSTRAINT "FK_d9c5f5c9474dfcca755a032020c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_129afebaa837c478366048522e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_440cacf9f7e8d07e76057e5546"`);
        await queryRunner.query(`DROP TABLE "users_preferred_task_types_task_types"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d8452d4a9c64c0c822841db1b2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b7b5e468f71266e9bf5ea446d3"`);
        await queryRunner.query(`DROP TABLE "users_households_households"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "households"`);
        await queryRunner.query(`DROP TABLE "house_types"`);
        await queryRunner.query(`DROP TABLE "pets"`);
        await queryRunner.query(`DROP TABLE "tasks"`);
        await queryRunner.query(`DROP TYPE "public"."tasks_status_enum"`);
        await queryRunner.query(`DROP TABLE "task_types"`);
    }

}
