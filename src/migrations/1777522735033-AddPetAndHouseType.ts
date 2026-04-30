import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPetAndHouseType1777522735033 implements MigrationInterface {
    name = 'AddPetAndHouseType1777522735033'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "kind" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "householdId" uuid, CONSTRAINT "PK_d01e9e7b4ada753c826720bee8b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "households" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "houseType" character varying, "inviteCode" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_422469a6ea94e4822ad3b8fee84" UNIQUE ("inviteCode"), CONSTRAINT "PK_2b1aef2640717132e9231aac756" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "assignee"`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "points" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "householdId" uuid`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "assigneeId" uuid`);
        await queryRunner.query(`ALTER TABLE "users" ADD "householdId" uuid`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_76cae6196c9ecff65d3ed796b34" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_9a16d2c86252529f622fa53f1e3" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pets" ADD CONSTRAINT "FK_1f9d8d87c46694b6a8793152374" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_079b6673b88101596abc9ef0fce" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_079b6673b88101596abc9ef0fce"`);
        await queryRunner.query(`ALTER TABLE "pets" DROP CONSTRAINT "FK_1f9d8d87c46694b6a8793152374"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_9a16d2c86252529f622fa53f1e3"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_76cae6196c9ecff65d3ed796b34"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "householdId"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "assigneeId"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "householdId"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "points"`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "assignee" character varying`);
        await queryRunner.query(`DROP TABLE "households"`);
        await queryRunner.query(`DROP TABLE "pets"`);
    }

}
