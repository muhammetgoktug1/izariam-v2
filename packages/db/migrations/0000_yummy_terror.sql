CREATE TYPE "public"."mission_kind" AS ENUM('colonise', 'transport', 'buy', 'sell', 'attack', 'plunder');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('wood', 'wine', 'marble', 'crystal', 'sulfur');--> statement-breakpoint
CREATE TYPE "public"."score_category" AS ENUM('total', 'buildings', 'levels', 'peoples', 'research', 'complete', 'army', 'gold', 'transports');--> statement-breakpoint
CREATE TYPE "public"."trade_direction" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."unit_queue_kind" AS ENUM('land', 'naval');--> statement-breakpoint
CREATE TABLE "army_units" (
	"town_id" integer NOT NULL,
	"unit_type" smallint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "army_units_town_id_unit_type_pk" PRIMARY KEY("town_id","unit_type")
);
--> statement-breakpoint
CREATE TABLE "branch_offers" (
	"town_id" integer NOT NULL,
	"resource" "resource_kind" NOT NULL,
	"direction" "trade_direction" NOT NULL,
	"count" numeric(20, 6) DEFAULT '0' NOT NULL,
	"price" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "branch_offers_town_id_resource_pk" PRIMARY KEY("town_id","resource")
);
--> statement-breakpoint
CREATE TABLE "build_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"town_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"slot" smallint NOT NULL,
	"type" smallint NOT NULL,
	"started_at" timestamp with time zone,
	CONSTRAINT "build_queue_town_position_unique" UNIQUE("town_id","position")
);
--> statement-breakpoint
CREATE TABLE "combat_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"attacker_user_id" integer,
	"defender_user_id" integer,
	"town_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "islands" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"type" smallint DEFAULT 1 NOT NULL,
	"trade_resource" smallint DEFAULT 3 NOT NULL,
	"wonder" smallint DEFAULT 0 NOT NULL,
	"wood_level" smallint DEFAULT 1 NOT NULL,
	"trade_level" smallint DEFAULT 1 NOT NULL,
	"wood_donated" numeric(20, 6) DEFAULT '0' NOT NULL,
	"trade_donated" numeric(20, 6) DEFAULT '0' NOT NULL,
	"wood_upgrade_started_at" timestamp with time zone,
	"trade_upgrade_started_at" timestamp with time zone,
	CONSTRAINT "islands_xy_unique" UNIQUE("x","y")
);
--> statement-breakpoint
CREATE TABLE "message_recipients" (
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"side" varchar(4) NOT NULL,
	"read_at" timestamp with time zone,
	"deleted" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "message_recipients_message_id_user_id_side_pk" PRIMARY KEY("message_id","user_id","side")
);
--> statement-breakpoint
CREATE TABLE "mission_trade_terms" (
	"mission_id" integer NOT NULL,
	"resource" "resource_kind" NOT NULL,
	"count" numeric(20, 6) DEFAULT '0' NOT NULL,
	"price" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "mission_trade_terms_mission_id_resource_pk" PRIMARY KEY("mission_id","resource")
);
--> statement-breakpoint
CREATE TABLE "mission_units" (
	"mission_id" integer NOT NULL,
	"unit_type" smallint NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "mission_units_mission_id_unit_type_pk" PRIMARY KEY("mission_id","unit_type")
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_town_id" integer NOT NULL,
	"to_town_id" integer,
	"kind" "mission_kind" NOT NULL,
	"loading_from_started_at" timestamp with time zone,
	"loading_to_started_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"return_started_at" timestamp with time zone,
	"arrives_at" timestamp with time zone,
	"abort_percent" numeric(6, 4) DEFAULT '0' NOT NULL,
	"transports" integer DEFAULT 0 NOT NULL,
	"wood" numeric(20, 6) DEFAULT '0' NOT NULL,
	"wine" numeric(20, 6) DEFAULT '0' NOT NULL,
	"marble" numeric(20, 6) DEFAULT '0' NOT NULL,
	"crystal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"sulfur" numeric(20, 6) DEFAULT '0' NOT NULL,
	"gold" numeric(20, 6) DEFAULT '0' NOT NULL,
	"peoples" numeric(20, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"body" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "spies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_town_id" integer NOT NULL,
	"to_town_id" integer,
	"risk" numeric(8, 4) DEFAULT '0' NOT NULL,
	"mission_type" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"last_update" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spy_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"spy_id" integer,
	"from_town_id" integer,
	"to_town_id" integer,
	"mission_type" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"report" text DEFAULT '{}' NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "town_buildings" (
	"town_id" integer NOT NULL,
	"slot" smallint NOT NULL,
	"type" smallint NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "town_buildings_town_id_slot_pk" PRIMARY KEY("town_id","slot")
);
--> statement-breakpoint
CREATE TABLE "town_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"town_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" varchar(48) NOT NULL,
	"params" text DEFAULT '{}' NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "towns" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"island_id" integer NOT NULL,
	"slot" smallint NOT NULL,
	"name" varchar(64) DEFAULT 'Polis' NOT NULL,
	"last_update" timestamp with time zone DEFAULT now() NOT NULL,
	"wood" numeric(20, 6) DEFAULT '500' NOT NULL,
	"wine" numeric(20, 6) DEFAULT '0' NOT NULL,
	"marble" numeric(20, 6) DEFAULT '0' NOT NULL,
	"crystal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"sulfur" numeric(20, 6) DEFAULT '0' NOT NULL,
	"peoples" numeric(20, 6) DEFAULT '40' NOT NULL,
	"workers" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tradegood" numeric(20, 6) DEFAULT '0' NOT NULL,
	"scientists" numeric(20, 6) DEFAULT '0' NOT NULL,
	"templer" numeric(20, 6) DEFAULT '0' NOT NULL,
	"spies" smallint DEFAULT 0 NOT NULL,
	"spy_training_started_at" timestamp with time zone,
	"workers_wood" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tradegood_wood" numeric(20, 6) DEFAULT '0' NOT NULL,
	"action_points" smallint DEFAULT 3 NOT NULL,
	"tavern_wine" smallint DEFAULT 0 NOT NULL,
	"branch_search_direction" "trade_direction",
	"branch_search_resource" "resource_kind",
	"branch_search_radius" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "towns_island_slot_unique" UNIQUE("island_id","slot")
);
--> statement-breakpoint
CREATE TABLE "trade_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_town_id" integer,
	"to_town_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"resource" "resource_kind" NOT NULL,
	"send_count" numeric(20, 6) DEFAULT '0' NOT NULL,
	"send_time" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"town_id" integer NOT NULL,
	"kind" "unit_queue_kind" NOT NULL,
	"position" smallint NOT NULL,
	"unit_type" smallint NOT NULL,
	"count" integer NOT NULL,
	"started_at" timestamp with time zone,
	CONSTRAINT "unit_queue_town_kind_position_unique" UNIQUE("town_id","kind","position")
);
--> statement-breakpoint
CREATE TABLE "user_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_user_id" integer,
	"kind" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_research" (
	"user_id" integer NOT NULL,
	"branch" smallint NOT NULL,
	"node" smallint NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_research_user_id_branch_node_pk" PRIMARY KEY("user_id","branch","node")
);
--> statement-breakpoint
CREATE TABLE "user_research_branch_seen" (
	"user_id" integer NOT NULL,
	"branch" smallint NOT NULL,
	"seen" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_research_branch_seen_user_id_branch_pk" PRIMARY KEY("user_id","branch")
);
--> statement-breakpoint
CREATE TABLE "user_scores" (
	"user_id" integer NOT NULL,
	"category" "score_category" NOT NULL,
	"value" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "user_scores_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"login" varchar(30) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"legacy_password_md5" varchar(32),
	"access_level" smallint DEFAULT 0 NOT NULL,
	"register_key" varchar(64),
	"register_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_visit_at" timestamp with time zone,
	"blocked_until" timestamp with time zone,
	"blocked_reason" text,
	"current_town_id" integer,
	"capital_town_id" integer,
	"gold" numeric(20, 6) DEFAULT '100' NOT NULL,
	"ambrosia" integer DEFAULT 1000 NOT NULL,
	"transports" integer DEFAULT 0 NOT NULL,
	"research_points" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tutorial_step" smallint DEFAULT 0 NOT NULL,
	"options_select" smallint DEFAULT 1 NOT NULL,
	"premium_account_until" timestamp with time zone,
	"premium_wood_until" timestamp with time zone,
	"premium_wine_until" timestamp with time zone,
	"premium_marble_until" timestamp with time zone,
	"premium_crystal_until" timestamp with time zone,
	"premium_sulfur_until" timestamp with time zone,
	"premium_capacity_until" timestamp with time zone,
	CONSTRAINT "users_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "army_units" ADD CONSTRAINT "army_units_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_offers" ADD CONSTRAINT "branch_offers_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_queue" ADD CONSTRAINT "build_queue_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combat_reports" ADD CONSTRAINT "combat_reports_attacker_user_id_users_id_fk" FOREIGN KEY ("attacker_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combat_reports" ADD CONSTRAINT "combat_reports_defender_user_id_users_id_fk" FOREIGN KEY ("defender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combat_reports" ADD CONSTRAINT "combat_reports_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_message_id_user_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."user_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_trade_terms" ADD CONSTRAINT "mission_trade_terms_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_units" ADD CONSTRAINT "mission_units_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_from_town_id_towns_id_fk" FOREIGN KEY ("from_town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_to_town_id_towns_id_fk" FOREIGN KEY ("to_town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spies" ADD CONSTRAINT "spies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spies" ADD CONSTRAINT "spies_from_town_id_towns_id_fk" FOREIGN KEY ("from_town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spies" ADD CONSTRAINT "spies_to_town_id_towns_id_fk" FOREIGN KEY ("to_town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spy_messages" ADD CONSTRAINT "spy_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spy_messages" ADD CONSTRAINT "spy_messages_from_town_id_towns_id_fk" FOREIGN KEY ("from_town_id") REFERENCES "public"."towns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spy_messages" ADD CONSTRAINT "spy_messages_to_town_id_towns_id_fk" FOREIGN KEY ("to_town_id") REFERENCES "public"."towns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_buildings" ADD CONSTRAINT "town_buildings_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_messages" ADD CONSTRAINT "town_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_messages" ADD CONSTRAINT "town_messages_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towns" ADD CONSTRAINT "towns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towns" ADD CONSTRAINT "towns_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_routes" ADD CONSTRAINT "trade_routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_routes" ADD CONSTRAINT "trade_routes_from_town_id_towns_id_fk" FOREIGN KEY ("from_town_id") REFERENCES "public"."towns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_routes" ADD CONSTRAINT "trade_routes_to_town_id_towns_id_fk" FOREIGN KEY ("to_town_id") REFERENCES "public"."towns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_queue" ADD CONSTRAINT "unit_queue_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_messages" ADD CONSTRAINT "user_messages_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_research" ADD CONSTRAINT "user_research_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_research_branch_seen" ADD CONSTRAINT "user_research_branch_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scores" ADD CONSTRAINT "user_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_offers_market_idx" ON "branch_offers" USING btree ("resource","direction","price");--> statement-breakpoint
CREATE INDEX "build_queue_town_idx" ON "build_queue" USING btree ("town_id");--> statement-breakpoint
CREATE INDEX "combat_reports_town_idx" ON "combat_reports" USING btree ("town_id");--> statement-breakpoint
CREATE INDEX "islands_xy_idx" ON "islands" USING btree ("x","y");--> statement-breakpoint
CREATE INDEX "message_recipients_inbox_idx" ON "message_recipients" USING btree ("user_id","side","deleted");--> statement-breakpoint
CREATE INDEX "missions_from_idx" ON "missions" USING btree ("from_town_id");--> statement-breakpoint
CREATE INDEX "missions_to_idx" ON "missions" USING btree ("to_town_id");--> statement-breakpoint
CREATE INDEX "missions_user_idx" ON "missions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "missions_arrives_idx" ON "missions" USING btree ("arrives_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "spies_from_idx" ON "spies" USING btree ("from_town_id");--> statement-breakpoint
CREATE INDEX "spies_user_idx" ON "spies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "spy_messages_user_created_idx" ON "spy_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "town_messages_user_created_idx" ON "town_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "towns_user_idx" ON "towns" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "towns_island_idx" ON "towns" USING btree ("island_id");--> statement-breakpoint
CREATE INDEX "trade_routes_user_idx" ON "trade_routes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trade_routes_next_run_idx" ON "trade_routes" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "unit_queue_town_idx" ON "unit_queue" USING btree ("town_id");--> statement-breakpoint
CREATE INDEX "user_messages_from_created_idx" ON "user_messages" USING btree ("from_user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_scores_rank_idx" ON "user_scores" USING btree ("category","value" DESC);--> statement-breakpoint
CREATE INDEX "users_login_idx" ON "users" USING btree ("login");