FROM gcr.io/distroless/java21-debian12:debug
WORKDIR /app
COPY main prover.jar ./
ENV NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["./main"]
