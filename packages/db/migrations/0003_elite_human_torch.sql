CREATE TABLE "miracle_activations" (
	"user_id" integer NOT NULL,
	"island_id" integer NOT NULL,
	"wonder" smallint NOT NULL,
	"level" smallint NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "miracle_activations" ADD CONSTRAINT "miracle_activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "miracle_activations" ADD CONSTRAINT "miracle_activations_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "miracle_activations_user_island_unique" ON "miracle_activations" USING btree ("user_id","island_id");--> statement-breakpoint
CREATE INDEX "miracle_activations_user_idx" ON "miracle_activations" USING btree ("user_id");